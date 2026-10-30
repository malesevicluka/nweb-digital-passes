import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";

export async function getToken(
    authority: string,
    audience: string,
    clientId: string,
    clientSecret: string,
    scope: string
): Promise<string> {
    const response = await fetch(
        `${authority.replace(/\/$/, "")}/oauth/token`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                grant_type: "client_credentials",
                audience: audience,
                client_id: clientId,
                client_secret: clientSecret,
                scope: scope
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            `Dohvat tokena: HTTP ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json() as { access_token?: string };

    if (typeof data.access_token !== "string" || !data.access_token) {
        throw new Error(
            `Dohvat tokena: HTTP ${response.status}, odgovor ne sadrži token.`
        );
    }

    return data.access_token;
}

export async function issuePass(
    url: string,
    token: string,
    name: string,
    document: string
): Promise<void> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: name,
            document: document
        })
    });

    if (!response.ok) {
        throw new Error(
            `Izdavanje propusnice: HTTP ${response.status} ${response.statusText}`
        );
    }

    const location = response.headers.get("Location");

    if (!location) {
        throw new Error(
            `Izdavanje propusnice: HTTP ${response.status}, nedostaje Location.`
        );
    }

    const id = new URL(location, url).pathname.split("/").pop();

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error(
            `Izdavanje propusnice: HTTP ${response.status}, neispravan identifikator.`
        );
    }

    const image = Buffer.from(await response.arrayBuffer());
    await writeFile(`${id}.png`, image);
}
