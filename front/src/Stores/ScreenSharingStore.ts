import {derived, get, Readable, readable, writable, Writable} from "svelte/store";
import {peerStore} from "./PeerStore";
import {localUserStore} from "../Connexion/LocalUserStore";
import {ITiledMapGroupLayer, ITiledMapObjectLayer, ITiledMapTileLayer} from "../Phaser/Map/ITiledMap";
import {userMovingStore} from "./GameStore";
import {HtmlUtils} from "../WebRtc/HtmlUtils";
import {
    audioConstraintStore, cameraEnergySavingStore,
    enableCameraSceneVisibilityStore,
    gameOverlayVisibilityStore, LocalStreamStoreValue, privacyShutdownStore,
    requestedCameraState,
    requestedMicrophoneState, videoConstraintStore
} from "./MediaStore";

declare const navigator:any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A store that contains the camera state requested by the user (on or off).
 */
function createRequestedScreenSharingState() {
    const { subscribe, set, update } = writable(false);

    return {
        subscribe,
        enableScreenSharing: () => set(true),
        disableScreenSharing: () => set(false),
    };
}

export const requestedScreenSharingState = createRequestedScreenSharingState();

let currentStream : MediaStream|null = null;

/**
 * Stops the camera from filming
 */
function stopScreenSharing(): void {
    if (currentStream) {
        for (const track of currentStream.getVideoTracks()) {
            track.stop();
        }
    }
    currentStream = null;
}

let previousComputedVideoConstraint: boolean|MediaTrackConstraints = false;
let previousComputedAudioConstraint: boolean|MediaTrackConstraints = false;

/**
 * A store containing the media constraints we want to apply.
 */
export const screenSharingConstraintsStore = derived(
    [
        requestedScreenSharingState,
        gameOverlayVisibilityStore,
        peerStore,
    ], (
        [
            $requestedScreenSharingState,
            $gameOverlayVisibilityStore,
            $peerStore,
        ], set
    ) => {

        let currentVideoConstraint: boolean|MediaTrackConstraints = true;
        let currentAudioConstraint: boolean|MediaTrackConstraints = false;

        // Disable screen sharing if the user requested so
        if (!$requestedScreenSharingState) {
            currentVideoConstraint = false;
            currentAudioConstraint = false;
        }

        // Disable screen sharing when in a Jitsi
        if (!$gameOverlayVisibilityStore) {
            currentVideoConstraint = false;
            currentAudioConstraint = false;
        }

        // Disable screen sharing if no peers
        if ($peerStore.size === 0) {
            currentVideoConstraint = false;
            currentAudioConstraint = false;
        }

        // Let's make the changes only if the new value is different from the old one.
        if (previousComputedVideoConstraint != currentVideoConstraint || previousComputedAudioConstraint != currentAudioConstraint) {
            previousComputedVideoConstraint = currentVideoConstraint;
            previousComputedAudioConstraint = currentAudioConstraint;
            // Let's copy the objects.
            /*if (typeof previousComputedVideoConstraint !== 'boolean') {
                previousComputedVideoConstraint = {...previousComputedVideoConstraint};
            }
            if (typeof previousComputedAudioConstraint !== 'boolean') {
                previousComputedAudioConstraint = {...previousComputedAudioConstraint};
            }*/

            set({
                video: currentVideoConstraint,
                audio: currentAudioConstraint,
            });
        }
    }, {
        video: false,
        audio: false
    } as MediaStreamConstraints);


/**
 * A store containing the MediaStream object for ScreenSharing (or null if nothing requested, or Error if an error occurred)
 */
export const screenSharingLocalStreamStore = derived<Readable<MediaStreamConstraints>, LocalStreamStoreValue>(screenSharingConstraintsStore, ($screenSharingConstraintsStore, set) => {
    const constraints = $screenSharingConstraintsStore;

    if ($screenSharingConstraintsStore.video === false && $screenSharingConstraintsStore.audio === false) {
        stopScreenSharing();
        requestedScreenSharingState.disableScreenSharing();
        set({
            type: 'success',
            stream: null,
            constraints
        });
        return;
    }

    let currentStreamPromise: Promise<MediaStream>;
    if (navigator.getDisplayMedia) {
        currentStreamPromise = navigator.getDisplayMedia({constraints});
    } else if (navigator.mediaDevices.getDisplayMedia) {
        currentStreamPromise = navigator.mediaDevices.getDisplayMedia({constraints});
    } else {
        stopScreenSharing();
        set({
            type: 'error',
            error: new Error('Your browser does not support sharing screen'),
            constraints
        });
        return;
    }

    (async () => {
        try {
            stopScreenSharing();
            currentStream = await currentStreamPromise;

            // If stream ends (for instance if user clicks the stop screen sharing button in the browser), let's close the view
            for (const track of currentStream.getTracks()) {
                track.onended = () => {
                    stopScreenSharing();
                    requestedScreenSharingState.disableScreenSharing();
                    previousComputedVideoConstraint = false;
                    previousComputedAudioConstraint = false;
                    set({
                        type: 'success',
                        stream: null,
                        constraints: {
                            video: false,
                            audio: false
                        }
                    });
                };
            }

            set({
                type: 'success',
                stream: currentStream,
                constraints
            });
            return;
        } catch (e) {
            currentStream = null;
            console.info("Error. Unable to share screen.", e);
            set({
                type: 'error',
                error: e,
                constraints
            });
        }
    })();
});

/**
 * A store containing whether the screen sharing button should be displayed or hidden.
 */
export const screenSharingAvailableStore = derived(peerStore, ($peerStore, set) => {
    if (!navigator.getDisplayMedia && !navigator.mediaDevices.getDisplayMedia) {
        set(false);
        return;
    }

    set($peerStore.size !== 0);
});
