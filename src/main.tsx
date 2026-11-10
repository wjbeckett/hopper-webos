import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// webOS TVs run an old Chromium (87 on webOS 22) on a weak GPU. This class
// switches on the lighter paint rules in styles.css.
if (/Web0S|webOS/i.test(navigator.userAgent)) document.documentElement.classList.add("webos");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
