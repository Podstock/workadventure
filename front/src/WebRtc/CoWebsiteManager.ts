import {HtmlUtils} from "./HtmlUtils";
import {Subject} from "rxjs";
import {iframeListener} from "../Api/IframeListener";

enum iframeStates {
    closed = 1,
    loading, // loading an iframe can be slow, so we show some placeholder until it is ready
    opened,
}

const cowebsiteDivId = 'cowebsite'; // the id of the whole container.
const cowebsiteMainDomId = 'cowebsite-main'; // the id of the parent div of the iframe.
const cowebsiteAsideDomId = 'cowebsite-aside'; // the id of the parent div of the iframe.
const cowebsiteCloseButtonId = 'cowebsite-close';
const cowebsiteFullScreenButtonId = 'cowebsite-fullscreen';
const cowebsiteOpenFullScreenImageId = 'cowebsite-fullscreen-open';
const cowebsiteCloseFullScreenImageId = 'cowebsite-fullscreen-close';
const animationTime = 500; //time used by the css transitions, in ms.

class CoWebsiteManager {

    private opened: iframeStates = iframeStates.closed;

    private _onResize: Subject<void> = new Subject();
    public onResize = this._onResize.asObservable();
    /**
     * Quickly going in and out of an iframe trigger can create conflicts between the iframe states.
     * So we use this promise to queue up every cowebsite state transition
     */
    private currentOperationPromise: Promise<void> = Promise.resolve();
    private cowebsiteDiv: HTMLDivElement;
    private resizing: boolean = false;
    private cowebsiteMainDom: HTMLDivElement;
    private cowebsiteAsideDom: HTMLDivElement;

    get width(): number {
        return this.cowebsiteDiv.clientWidth;
    }

    set width(width: number) {
        this.cowebsiteDiv.style.width = width+'px';
    }

    get height(): number {
        return this.cowebsiteDiv.clientHeight;
    }

    set height(height: number) {
        this.cowebsiteDiv.style.height = height+'px';
    }

    get verticalMode(): boolean {
        return window.innerWidth < window.innerHeight;
    }

    get isFullScreen(): boolean {
        return this.verticalMode ? this.height === window.innerHeight : this.width === window.innerWidth;
    }

    constructor() {
        this.cowebsiteDiv = HtmlUtils.getElementByIdOrFail<HTMLDivElement>(cowebsiteDivId);
        this.cowebsiteMainDom = HtmlUtils.getElementByIdOrFail<HTMLDivElement>(cowebsiteMainDomId);
        this.cowebsiteAsideDom = HtmlUtils.getElementByIdOrFail<HTMLDivElement>(cowebsiteAsideDomId);

        this.initResizeListeners();

        HtmlUtils.getElementByIdOrFail(cowebsiteCloseButtonId).addEventListener('click', () => {
            this.closeCoWebsite();
        });
        HtmlUtils.getElementByIdOrFail(cowebsiteFullScreenButtonId).addEventListener('click', () => {
            this.fullscreen();
        });
    }

    private initResizeListeners() {
        const movecallback = (event:MouseEvent) => {
            this.verticalMode ? this.height += event.movementY / this.getDevicePixelRatio() : this.width -= event.movementX / this.getDevicePixelRatio();
            this.fire();
        }

        this.cowebsiteAsideDom.addEventListener('mousedown', (event) => {
            this.resizing = true;
            this.getIframeDom().style.display = 'none';

            document.addEventListener('mousemove', movecallback);
        });

        document.addEventListener('mouseup', (event) => {
            if (!this.resizing) return;
            document.removeEventListener('mousemove', movecallback);
            this.getIframeDom().style.display = 'block';
            this.resizing = false;
        });
    }

    private getDevicePixelRatio(): number {
        //on chrome engines, movementX and movementY return global screens coordinates while other browser return pixels
        //so on chrome-based browser we need to adjust using 'devicePixelRatio'
        return window.navigator.userAgent.includes('Firefox') ? 1 : window.devicePixelRatio;
    }

    private close(): void {
        this.cowebsiteDiv.classList.remove('loaded'); //edit the css class to trigger the transition
        this.cowebsiteDiv.classList.add('hidden');
        this.opened = iframeStates.closed;
        this.resetStyle();
    }
    private load(): void {
        this.cowebsiteDiv.classList.remove('hidden'); //edit the css class to trigger the transition
        this.cowebsiteDiv.classList.add('loading');
        this.opened = iframeStates.loading;
    }
    private open(): void {
        this.cowebsiteDiv.classList.remove('loading', 'hidden'); //edit the css class to trigger the transition
        this.opened = iframeStates.opened;
        this.resetStyle();
    }

    public resetStyle() {
        this.cowebsiteDiv.style.width = '';
        this.cowebsiteDiv.style.height = '';
    }

    private getIframeDom(): HTMLIFrameElement {
        const iframe = HtmlUtils.getElementByIdOrFail<HTMLDivElement>(cowebsiteDivId).querySelector('iframe');
        if (!iframe) throw new Error('Could not find iframe!');
        return iframe;
    }

    public loadCoWebsite(url: string, base: string, allowApi?: boolean, allowPolicy?: string): void {
        this.load();
        this.cowebsiteMainDom.innerHTML = ``;

        const iframe = document.createElement('iframe');
        iframe.id = 'cowebsite-iframe';
        iframe.src = (new URL(url, base)).toString();
        if (allowPolicy) {
            iframe.allow = allowPolicy;
        }
        const onloadPromise = new Promise<void>((resolve) => {
            iframe.onload = () => resolve();
        });
        if (allowApi) {
            iframeListener.registerIframe(iframe);
        }
        this.cowebsiteMainDom.appendChild(iframe);
        const onTimeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 2000);
        });
        this.currentOperationPromise = this.currentOperationPromise.then(() =>Promise.race([onloadPromise, onTimeoutPromise])).then(() => {
            this.open();
            setTimeout(() => {
                this.fire();
            }, animationTime)
        }).catch(() => this.closeCoWebsite());
    }

    /**
     * Just like loadCoWebsite but the div can be filled by the user.
     */
    public insertCoWebsite(callback: (cowebsite: HTMLDivElement) => Promise<void>): void {
        this.load();
        this.cowebsiteMainDom.innerHTML = ``;
        this.currentOperationPromise = this.currentOperationPromise.then(() => callback(this.cowebsiteMainDom)).then(() => {
            this.open();
            setTimeout(() => {
                this.fire();
            }, animationTime);
        }).catch(() => this.closeCoWebsite());
    }

    public closeCoWebsite(): Promise<void> {
        this.currentOperationPromise = this.currentOperationPromise.then(() => new Promise((resolve, reject) => {
            if(this.opened === iframeStates.closed) resolve(); //this method may be called twice, in case of iframe error for example
            this.close();
            this.fire();
            const iframe = this.cowebsiteDiv.querySelector('iframe');
            if (iframe) {
                iframeListener.unregisterIframe(iframe);
            }
            setTimeout(() => {
                this.cowebsiteMainDom.innerHTML = ``;
                resolve();
            }, animationTime)
        }));
        return this.currentOperationPromise;
    }

    public getGameSize(): {width: number, height: number} {
        if (this.opened !== iframeStates.opened) {
            return {
                width: window.innerWidth,
                height: window.innerHeight
            }
        }
        if (!this.verticalMode) {
            return {
                width: window.innerWidth - this.width,
                height: window.innerHeight
            }
        } else {
            return {
                width: window.innerWidth,
                height: window.innerHeight - this.height,
            }
        }
    }

    private fire(): void {
        this._onResize.next();
    }

    private fullscreen(): void {
        if (this.isFullScreen) {
            this.resetStyle();
            this.fire();
            //we don't trigger a resize of the phaser game since it won't be visible anyway.
            HtmlUtils.getElementByIdOrFail(cowebsiteOpenFullScreenImageId).style.display = 'inline';
            HtmlUtils.getElementByIdOrFail(cowebsiteCloseFullScreenImageId).style.display = 'none';
        } else {
            this.verticalMode ? this.height = window.innerHeight : this.width = window.innerWidth;
            //we don't trigger a resize of the phaser game since it won't be visible anyway.
            HtmlUtils.getElementByIdOrFail(cowebsiteOpenFullScreenImageId).style.display = 'none';
            HtmlUtils.getElementByIdOrFail(cowebsiteCloseFullScreenImageId).style.display = 'inline';
        }
    }
}

export const coWebsiteManager = new CoWebsiteManager();
