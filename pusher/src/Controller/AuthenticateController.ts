import { v4 } from 'uuid';
import {HttpRequest, HttpResponse, TemplatedApp} from "uWebSockets.js";
import {BaseController} from "./BaseController";
import {adminApi} from "../Services/AdminApi";
import {jwtTokenManager} from "../Services/JWTTokenManager";
import {parse} from "query-string";
import Axios from "axios";

export interface TokenInterface {
    userUuid: string
}

export class AuthenticateController extends BaseController {

    constructor(private App : TemplatedApp) {
        super();
        this.register();
        this.verify();
        this.anonymLogin();
        this.podstock();
    }

    //Try to login with an admin token
    private register(){
        this.App.options("/register", (res: HttpResponse, req: HttpRequest) => {
            this.addCorsHeaders(res);

            res.end();
        });

        this.App.post("/register", (res: HttpResponse, req: HttpRequest) => {
            (async () => {
                res.onAborted(() => {
                    console.warn('Login request was aborted');
                })
                const param = await res.json();

                //todo: what to do if the organizationMemberToken is already used?
                const organizationMemberToken:string|null = param.organizationMemberToken;

                try {
                    if (typeof organizationMemberToken != 'string') throw new Error('No organization token');
                    const data = await adminApi.fetchMemberDataByToken(organizationMemberToken);
                    const userUuid = data.userUuid;
                    const organizationSlug = data.organizationSlug;
                    const worldSlug = data.worldSlug;
                    const roomSlug = data.roomSlug;
                    const mapUrlStart = data.mapUrlStart;
                    const textures = data.textures;

                    const authToken = jwtTokenManager.createJWTToken(userUuid);
                    res.writeStatus("200 OK");
                    this.addCorsHeaders(res);
                    res.end(JSON.stringify({
                        authToken,
                        userUuid,
                        organizationSlug,
                        worldSlug,
                        roomSlug,
                        mapUrlStart,
                        organizationMemberToken,
                        textures
                    }));

                } catch (e) {
                    this.errorToResponse(e, res);
                }


            })();
        });

    }

    private verify(){
        this.App.options("/verify", (res: HttpResponse, req: HttpRequest) => {
            this.addCorsHeaders(res);

            res.end();
        });

        this.App.get("/verify", (res: HttpResponse, req: HttpRequest) => {
            (async () => {
                const query = parse(req.getQuery());

                res.onAborted(() => {
                    console.warn('verify request was aborted');
                })

                try {
                    const uuid = await jwtTokenManager.getUserUuidFromToken(query.token as string);
                    await Axios.get('https://mein.podstock.de/api/user/uuid/'+uuid);
                } catch (e) {
                    res.writeStatus("400 Bad Request");
                    this.addCorsHeaders(res);
                    res.end(JSON.stringify({
                        "success": false,
                        "message": "Invalid JWT token"
                    }));
                    return;
                }
                res.writeStatus("200 OK");
                this.addCorsHeaders(res);
                res.end(JSON.stringify({
                    "success": true
                }));
            })();
        });

    }

    //permit to login on application. Return token to connect on Websocket IO.
    private anonymLogin(){
        this.App.options("/anonymLogin", (res: HttpResponse, req: HttpRequest) => {
            this.addCorsHeaders(res);
            res.end();
        });

        this.App.post("/anonymLogin", (res: HttpResponse, req: HttpRequest) => {           
            res.onAborted(() => {
                console.warn('Login request was aborted');
            })

            res.writeStatus("401 Not authorized");
            this.addCorsHeaders(res);
            res.end("Please login with https://mein.podstock.de");

            // const userUuid = v4();
            // const authToken = jwtTokenManager.createJWTToken(userUuid);
            // res.writeStatus("200 OK");
            // this.addCorsHeaders(res);
            // res.end(JSON.stringify({
            //     authToken,
            //     userUuid,
            // }));
        });
    }

    private podstock(){
        this.App.options("/podstock", (res: HttpResponse, req: HttpRequest) => {
            this.addCorsHeaders(res);
            res.end();
        });

        this.App.post("/podstock", (res: HttpResponse, req: HttpRequest) => {           
            (async () => {
                res.onAborted(() => {
                    console.warn('Login request was aborted');
                })
                const param = await res.json();

                try {
                    const podstockuuid:string = param.podstockuuid;
                    const res_api = await Axios.get('https://mein.podstock.de/api/user/uuid/'+podstockuuid);
                    const userUuid = res_api.data.uuid;
                    const username = res_api.data.username;
                    const authToken = jwtTokenManager.createJWTToken(userUuid);
                    res.writeStatus("200 OK");
                    this.addCorsHeaders(res);
                    res.end(JSON.stringify({
                        authToken,
                        userUuid,
                        username
                    }));
                } catch (e) {
                        this.errorToResponse(e, res);
                }
            })();
        });
    }
}
