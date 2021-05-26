import {PointInterface} from "./Websocket/PointInterface";
import {Group} from "./Group";
import {User, UserSocket} from "./User";
import {PositionInterface} from "_Model/PositionInterface";
import {EmoteCallback, EntersCallback, LeavesCallback, MovesCallback} from "_Model/Zone";
import {PositionNotifier} from "./PositionNotifier";
import {Movable} from "_Model/Movable";
import {extractDataFromPrivateRoomId, extractRoomSlugPublicRoomId, isRoomAnonymous} from "./RoomIdentifier";
import {arrayIntersect} from "../Services/ArrayHelper";
import {EmoteEventMessage, JoinRoomMessage} from "../Messages/generated/messages_pb";
import {ProtobufUtils} from "../Model/Websocket/ProtobufUtils";
import {ZoneSocket} from "src/RoomManager";
import {Admin} from "../Model/Admin";

export type ConnectCallback = (user: User, group: Group) => void;
export type DisconnectCallback = (user: User, group: Group) => void;

export enum GameRoomPolicyTypes {
    ANONYMOUS_POLICY = 1,
    MEMBERS_ONLY_POLICY,
    USE_TAGS_POLICY,
}

export class GameRoom {
    private readonly minDistance: number;
    private readonly groupRadius: number;

    // Users, sorted by ID
    private readonly users: Map<number, User>;
    private readonly usersByUuid: Map<string, User>;
    private readonly groups: Set<Group>;
    private readonly admins: Set<Admin>;

    private readonly connectCallback: ConnectCallback;
    private readonly disconnectCallback: DisconnectCallback;

    private itemsState: Map<number, unknown> = new Map<number, unknown>();

    private readonly positionNotifier: PositionNotifier;
    public readonly roomId: string;
    public readonly roomSlug: string;
    public readonly worldSlug: string = '';
    public readonly organizationSlug: string = '';
    private versionNumber:number = 1;
    private nextUserId: number = 1;

    constructor(roomId: string,
                connectCallback: ConnectCallback,
                disconnectCallback: DisconnectCallback,
                minDistance: number,
                groupRadius: number,
                onEnters: EntersCallback,
                onMoves: MovesCallback,
                onLeaves: LeavesCallback,
                onEmote: EmoteCallback,
    ) {
        this.roomId = roomId;

        if (isRoomAnonymous(roomId)) {
            this.roomSlug = extractRoomSlugPublicRoomId(this.roomId);
        } else {
            const {organizationSlug, worldSlug, roomSlug} = extractDataFromPrivateRoomId(this.roomId);
            this.roomSlug = roomSlug;
            this.organizationSlug = organizationSlug;
            this.worldSlug = worldSlug;
        }


        this.users = new Map<number, User>();
        this.usersByUuid = new Map<string, User>();
        this.admins = new Set<Admin>();
        this.groups = new Set<Group>();
        this.connectCallback = connectCallback;
        this.disconnectCallback = disconnectCallback;
        this.minDistance = minDistance;
        this.groupRadius = groupRadius;
        // A zone is 10 sprites wide.
        this.positionNotifier = new PositionNotifier(320, 320, onEnters, onMoves, onLeaves, onEmote);
    }

    public getGroups(): Group[] {
        return Array.from(this.groups.values());
    }

    public getUsers(): Map<number, User> {
        return this.users;
    }

    public getUserByUuid(uuid: string): User|undefined {
        return this.usersByUuid.get(uuid);
    }

    public join(socket : UserSocket, joinRoomMessage: JoinRoomMessage): User {
        const positionMessage = joinRoomMessage.getPositionmessage();
        if (positionMessage === undefined) {
            throw new Error('Missing position message');
        }
        const position = ProtobufUtils.toPointInterface(positionMessage);

        const user = new User(this.nextUserId,
            joinRoomMessage.getUseruuid(),
            joinRoomMessage.getIpaddress(),
            position,
            false,
            this.positionNotifier,
            socket,
            joinRoomMessage.getTagList(),
            joinRoomMessage.getName(),
            ProtobufUtils.toCharacterLayerObjects(joinRoomMessage.getCharacterlayerList()),
            joinRoomMessage.getCompanion()
        );
        this.nextUserId++;
        this.users.set(user.id, user);
        this.usersByUuid.set(user.uuid, user);
        this.updateUserGroup(user);

        // Notify admins
        for (const admin of this.admins) {
            admin.sendUserJoin(user.uuid, user.name, user.IPAddress);
        }

        return user;
    }

    public leave(user : User){
        const userObj = this.users.get(user.id);
        if (userObj === undefined) {
            console.warn('User ', user.id, 'does not belong to this game room! It should!');
        }
        if (userObj !== undefined && typeof userObj.group !== 'undefined') {
            this.leaveGroup(userObj);
        }
        this.users.delete(user.id);
        this.usersByUuid.delete(user.uuid);

        if (userObj !== undefined) {
            this.positionNotifier.leave(userObj);
        }

        // Notify admins
        for (const admin of this.admins) {
            admin.sendUserLeft(user.uuid/*, user.name, user.IPAddress*/);
        }
    }

    public isEmpty(): boolean {
        return this.users.size === 0 && this.admins.size === 0;
    }

    public updatePosition(user : User, userPosition: PointInterface): void {
        user.setPosition(userPosition);

        this.updateUserGroup(user);
    }

    private updateUserGroup(user: User): void {
        user.group?.updatePosition();

        if (user.silent) {
            return;
        }

        if (user.group === undefined) {
            // If the user is not part of a group:
            //  should he join a group?

            // If the user is moving, don't try to join
            if (user.getPosition().moving) {
                return;
            }

            const closestItem: User|Group|null = this.searchClosestAvailableUserOrGroup(user);

            if (closestItem !== null) {
                if (closestItem instanceof Group) {
                    // Let's join the group!
                    closestItem.join(user);
                } else {
                    const closestUser : User = closestItem;
                    const group: Group = new Group(this.roomId,[
                        user,
                        closestUser
                    ], this.connectCallback, this.disconnectCallback, this.positionNotifier);
                    this.groups.add(group);
                }
            }

        } else {
            // If the user is part of a group:
            //  should he leave the group?
            const distance = GameRoom.computeDistanceBetweenPositions(user.getPosition(), user.group.getPosition());
            if (distance > this.groupRadius) {
                this.leaveGroup(user);
            }
        }
    }

    setSilent(user: User, silent: boolean) {
        if (user.silent === silent) {
            return;
        }

        user.silent = silent;
        if (silent && user.group !== undefined) {
            this.leaveGroup(user);
        }
        if (!silent) {
            // If we are back to life, let's trigger a position update to see if we can join some group.
            this.updatePosition(user, user.getPosition());
        }
    }

    /**
     * Makes a user leave a group and closes and destroy the group if the group contains only one remaining person.
     *
     * @param user
     */
    private leaveGroup(user: User): void {
        const group = user.group;
        if (group === undefined) {
            throw new Error("The user is part of no group");
        }
        group.leave(user);
        if (group.isEmpty()) {
            this.positionNotifier.leave(group);
            group.destroy();
            if (!this.groups.has(group)) {
                throw new Error("Could not find group "+group.getId()+" referenced by user "+user.id+" in World.");
            }
            this.groups.delete(group);
            //todo: is the group garbage collected?
        } else {
            group.updatePosition();
            //this.positionNotifier.updatePosition(group, group.getPosition(), oldPosition);
        }
    }

    /**
     * Looks for the closest user that is:
     * - close enough (distance <= minDistance)
     * - not in a group
     * - not silent
     * OR
     * - close enough to a group (distance <= groupRadius)
     */
    private searchClosestAvailableUserOrGroup(user: User): User|Group|null
    {
        let minimumDistanceFound: number = Math.max(this.minDistance, this.groupRadius);
        let matchingItem: User | Group | null = null;
        this.users.forEach((currentUser, userId) => {
            // Let's only check users that are not part of a group
            if (typeof currentUser.group !== 'undefined') {
                return;
            }
            if(currentUser === user) {
                return;
            }
            if (currentUser.silent) {
                return;
            }

            const distance = GameRoom.computeDistance(user, currentUser); // compute distance between peers.

            if(distance <= minimumDistanceFound && distance <= this.minDistance) {
                minimumDistanceFound = distance;
                matchingItem = currentUser;
            }
        });

        this.groups.forEach((group: Group) => {
            if (group.isFull()) {
                return;
            }
            const distance = GameRoom.computeDistanceBetweenPositions(user.getPosition(), group.getPosition());
            if(distance <= minimumDistanceFound && distance <= this.groupRadius) {
                minimumDistanceFound = distance;
                matchingItem = group;
            }
        });

        return matchingItem;
    }

    public static computeDistance(user1: User, user2: User): number
    {
        const user1Position = user1.getPosition();
        const user2Position = user2.getPosition();
        return Math.sqrt(Math.pow(user2Position.x - user1Position.x, 2) + Math.pow(user2Position.y - user1Position.y, 2));
    }

    public static computeDistanceBetweenPositions(position1: PositionInterface, position2: PositionInterface): number
    {
        return Math.sqrt(Math.pow(position2.x - position1.x, 2) + Math.pow(position2.y - position1.y, 2));
    }

    public setItemState(itemId: number, state: unknown) {
        this.itemsState.set(itemId, state);
    }

    public getItemsState(): Map<number, unknown> {
        return this.itemsState;
    }

    public addZoneListener(call: ZoneSocket, x: number, y: number): Set<Movable> {
        return this.positionNotifier.addZoneListener(call, x, y);
    }

    public removeZoneListener(call: ZoneSocket, x: number, y: number): void {
        return this.positionNotifier.removeZoneListener(call, x, y);
    }

    public adminJoin(admin: Admin): void {
        this.admins.add(admin);

        // Let's send all connected users
        for (const user of this.users.values()) {
            admin.sendUserJoin(user.uuid, user.name, user.IPAddress);
        }
    }

    public adminLeave(admin: Admin): void {
        this.admins.delete(admin);
    }
    
    public incrementVersion(): number {
        this.versionNumber++
        return this.versionNumber;
    }

    public emitEmoteEvent(user: User, emoteEventMessage: EmoteEventMessage) {
        this.positionNotifier.emitEmoteEvent(user, emoteEventMessage);
    }
}
