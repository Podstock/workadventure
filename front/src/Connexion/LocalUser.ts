import {MAX_USERNAME_LENGTH} from "../Enum/EnvironmentVariable";

export interface CharacterTexture {
    id: number,
    level: number,
    url: string,
    rights: string
}

export const maxUserNameLength: number = MAX_USERNAME_LENGTH;

export function isUserNameValid(value: string): boolean {
    const regexp = new RegExp('^[A-Za-z0-9]{1,'+maxUserNameLength+'}$');
    return regexp.test(value);
}

export function areCharacterLayersValid(value: string[] | null): boolean {
    if (!value || !value.length) return false;
    for (let i = 0; i < value.length; i++) {
        if (/^\w+$/.exec(value[i]) === null) {
            return false;
        }
    }
    return true;
}

export class LocalUser {
    constructor(public readonly uuid:string, public readonly jwtToken: string, public readonly textures: CharacterTexture[]) {
    }
}
