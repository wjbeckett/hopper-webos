import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { afterBootSplashStarts, releaseBootSplashWhenDone } from "./core/bootSplash";
import { migratePlainSessions, serverRegistry } from "./core/serverRegistry";
import { loadSecrets } from "./core/secureStore";

// webOS TVs run an old Chromium (87 on webOS 22) on a weak GPU. This class
// switches on the lighter paint rules in styles.css.
if (/Web0S|webOS/i.test(navigator.userAgent)) document.documentElement.classList.add("webos");

// Sign-in tokens are encrypted at rest (core/secureStore). Decrypt them before anything reads
// a session; the static splash in index.html is already on screen meanwhile.
const secretsStartedAt = performance.now();
void loadSecrets()
  .then(migratePlainSessions)
  .catch(error => console.warn("[Hopper] secure storage", error))
  .finally(() => {
    console.info(`[Hopper] sign-in storage ready in ${Math.round(performance.now() - secretsStartedAt)} ms`);
    releaseBootSplashWhenDone(Boolean(serverRegistry.active()?.session));
    afterBootSplashStarts(() => {
      ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    });
  });
