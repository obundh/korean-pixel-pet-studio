import { app, net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "app";
export const APP_HOST = "bundle";

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Serves only files below the built renderer root. The standard/secure custom
 * scheme lets renderer code fetch bundled background-removal model files via
 * relative URLs without granting `file://` access.
 */
export async function installAppProtocol(): Promise<void> {
  const rendererRoot = path.resolve(app.getAppPath(), "dist", "renderer");

  await protocol.handle(APP_SCHEME, async (request) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    if (requestUrl.hostname !== APP_HOST) {
      return new Response("Not found", { status: 404 });
    }

    let relativePath: string;
    try {
      relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!relativePath) relativePath = "index.html";

    const targetPath = path.resolve(rendererRoot, relativePath);
    const contained =
      targetPath === rendererRoot || targetPath.startsWith(`${rendererRoot}${path.sep}`);
    if (!contained) return new Response("Forbidden", { status: 403 });

    return net.fetch(pathToFileURL(targetPath).toString());
  });
}

export function rendererEntryUrl(mode: "studio" | "pet"): string {
  const url = new URL(`${APP_SCHEME}://${APP_HOST}/index.html`);
  url.searchParams.set("mode", mode);
  return url.toString();
}
