import {ADMIN_API_TOKEN, ADMIN_API_URL} from "../Enum/EnvironmentVariable";
import Axios from "axios";


class AdminApi {

    fetchVisitCardUrl(membershipUuid: string): Promise<string> {
        return Axios.get('https://mein.podstock.de/api/user/card_url/'+membershipUuid).then((res) => {
            return res.data;
        }).catch(() => {
            return 'INVALID';
        });
    }
}

export const adminApi = new AdminApi();
