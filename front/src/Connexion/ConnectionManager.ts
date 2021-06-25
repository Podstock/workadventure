import Axios from "axios";
import {PUSHER_URL, START_ROOM_URL} from "../Enum/EnvironmentVariable";
import {RoomConnection} from "./RoomConnection";
import type {OnConnectInterface, PositionInterface, ViewportInterface} from "./ConnexionModels";
import {GameConnexionTypes, urlManager} from "../Url/UrlManager";
import {localUserStore} from "./LocalUserStore";
import {CharacterTexture, LocalUser} from "./LocalUser";
import {Room} from "./Room";
import {gameManager} from "../Phaser/Game/GameManager";


class ConnectionManager {
    private localUser!:LocalUser;

    private connexionType?: GameConnexionTypes
    private reconnectingTimeout: NodeJS.Timeout|null = null;
    private _unloading:boolean = false;

    get unloading () {
        return this._unloading;
    }

    constructor() {
        window.addEventListener('beforeunload', () => {
            this._unloading = true;
            if (this.reconnectingTimeout) clearTimeout(this.reconnectingTimeout)
        })
    }
    /**
     * Tries to login to the node server and return the starting map url to be loaded
     */
    public async initGameConnexion(): Promise<Room> {

        const connexionType = urlManager.getGameConnexionType();
        this.connexionType = connexionType;
        if(connexionType === GameConnexionTypes.register) {
           const organizationMemberToken = urlManager.getOrganizationToken();
            const data = await Axios.post(`${PUSHER_URL}/register`, {organizationMemberToken}).then(res => res.data);
            this.localUser = new LocalUser(data.userUuid, data.authToken, data.textures);
            localUserStore.saveUser(this.localUser);

            const organizationSlug = data.organizationSlug;
            const worldSlug = data.worldSlug;
            const roomSlug = data.roomSlug;

            const room = new Room('/@/'+organizationSlug+'/'+worldSlug+'/'+roomSlug + window.location.search + window.location.hash);
            urlManager.pushRoomIdToUrl(room);
            return Promise.resolve(room);
        } else if (connexionType === GameConnexionTypes.organization || connexionType === GameConnexionTypes.anonymous || connexionType === GameConnexionTypes.empty || connexionType === GameConnexionTypes.podstock) {
            let localUser = localUserStore.getLocalUser();
            if (localUser && localUser.jwtToken && localUser.uuid && localUser.textures) {
                this.localUser = localUser;
                try {
                    await this.verifyToken(localUser.jwtToken);
                } catch(e) {
                    // If the token is invalid, let's generate an anonymous one.
                    console.error('JWT token invalid. Did it expire? Login anonymously instead.');
                    await this.anonymousLogin();
                }
            }else{
                if (connexionType === GameConnexionTypes.podstock) {
                    const podstockuuid = urlManager.getPodstockUuid();
                    const data = await Axios.post(`${PUSHER_URL}/podstock`, {podstockuuid}).then(res => res.data);
                    this.localUser = new LocalUser(data.userUuid, data.authToken, []);
                    localUserStore.saveUser(this.localUser);
                    localUserStore.setName(data.username);
                    gameManager.setPlayerName(data.username);
                } else {
                    await this.anonymousLogin();
                }
            }

            localUser = localUserStore.getLocalUser();
            if(!localUser){
                throw "Error to store local user data";
            }

            let roomId: string;
            if (connexionType === GameConnexionTypes.empty || connexionType === GameConnexionTypes.podstock) {
                roomId = START_ROOM_URL;
            } else {
                roomId = window.location.pathname + window.location.search + window.location.hash;
            }

            //get detail map for anonymous login and set texture in local storage
            const room = new Room(roomId);
            const mapDetail = await room.getMapDetail();
            if(mapDetail.textures != undefined && mapDetail.textures.length > 0) {
                //check if texture was changed
                if(localUser.textures.length === 0){
                    localUser.textures = mapDetail.textures;
                }else{
                    mapDetail.textures.forEach((newTexture) => {
                        const alreadyExistTexture = localUser?.textures.find((c) => newTexture.id === c.id);
                        if(localUser?.textures.findIndex((c) => newTexture.id === c.id) !== -1){
                            return;
                        }
                        localUser?.textures.push(newTexture)
                    });
                }
                this.localUser = localUser;
                localUserStore.saveUser(localUser);
            }
            return Promise.resolve(room);
        }

        return Promise.reject(new Error('Invalid URL'));
    }

    private async verifyToken(token: string): Promise<void> {
        await Axios.get(`${PUSHER_URL}/verify`, {params: {token}});
    }

    public async anonymousLogin(isBenchmark: boolean = false): Promise<void> {
        const data = await Axios.post(`${PUSHER_URL}/anonymLogin`).then(res => res.data);
        this.localUser = new LocalUser(data.userUuid, data.authToken, []);
        if (!isBenchmark) { // In benchmark, we don't have a local storage.
            localUserStore.saveUser(this.localUser);
        }
    }

    public initBenchmark(): void {
        this.localUser = new LocalUser('', 'test', []);
    }

    public connectToRoomSocket(apiUrl: string, roomId: string, name: string, characterLayers: string[], position: PositionInterface, viewport: ViewportInterface, companion: string|null): Promise<OnConnectInterface> {
        return new Promise<OnConnectInterface>((resolve, reject) => {
            const connection = new RoomConnection(apiUrl, this.localUser.jwtToken, roomId, name, characterLayers, position, viewport, companion);
            connection.onConnectError((error: object) => {
                console.log('An error occurred while connecting to socket server. Retrying');
                reject(error);
            });

            connection.onConnectingError((event: CloseEvent) => {
                console.log('An error occurred while connecting to socket server. Retrying');
                reject(new Error('An error occurred while connecting to socket server. Retrying. Code: '+event.code+', Reason: '+event.reason));
            });

            connection.onConnect((connect: OnConnectInterface) => {
                resolve(connect);
            });

        }).catch((err) => {
            // Let's retry in 4-6 seconds
            return new Promise<OnConnectInterface>((resolve, reject) => {
                this.reconnectingTimeout = setTimeout(() => {
                    //todo: allow a way to break recursion?
                    //todo: find a way to avoid recursive function. Otherwise, the call stack will grow indefinitely.
                    this.connectToRoomSocket(apiUrl, roomId, name, characterLayers, position, viewport, companion).then((connection) => resolve(connection));
                }, 4000 + Math.floor(Math.random() * 2000) );
            });
        });
    }

    get getConnexionType(){
        return this.connexionType;
    }
}

export const connectionManager = new ConnectionManager();
