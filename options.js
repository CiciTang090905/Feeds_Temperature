const USER_SESSION_KEY = "user_session";
const USERS_LOGIN_URL = "http://localhost:3001/api/users/login";
const USERS_REGISTER_URL = "http://localhost:3001/api/users/register";
const USERS_ME_URL = "http://localhost:3001/api/users/me";
const TOKEN_REGEX = /^[0-9a-f]{64}$/;

const app = document.getElementById("app");

let state = {
    session: null,
    pendingToken: "",
    view: "login",
    error: "",
    message: "",
    revealToken: false,
};

init().catch((error) => {
    renderFatal(error.message);
});

async function init() {
    state.session = await getStoredSession();
    state.view = state.session ? "settings" : "login";
    render();
}

function render() {
    if (state.view === "login") {
        renderLoginView();
        return;
    }

    if (state.view === "create") {
        renderCreateView();
        return;
    }

    if (state.view === "save-token") {
        renderSaveTokenView();
        return;
    }

    renderSettingsView();
}

function renderLoginView() {
    app.innerHTML = `
        <section class="card stack">
            <div>
                <h2>Enter your access code</h2>
                <p class="small">Paste the code tied to your account to restore your stats on this browser.</p>
            </div>
            <div>
                <label class="field-label" for="token-input">Access code</label>
                <input id="token-input" type="text" placeholder="Paste your code..." autocomplete="off" spellcheck="false">
            </div>
            ${renderFeedback()}
            <div class="actions">
                <button class="primary" id="continue-button">Continue</button>
                <button class="link-button" id="show-create-button">Don't have one yet? Create a new account</button>
            </div>
        </section>
    `;

    document.getElementById("continue-button").addEventListener("click", submitLogin);
    document.getElementById("show-create-button").addEventListener("click", () => {
        state.error = "";
        state.message = "";
        state.view = "create";
        render();
    });
}

function renderCreateView() {
    app.innerHTML = `
        <section class="card stack">
            <div>
                <h2>Create a new account</h2>
                <p class="small">Pick a display name. We will generate a one-time access code for you to save.</p>
            </div>
            <div>
                <label class="field-label" for="username-input">Display name</label>
                <input id="username-input" type="text" maxlength="100" placeholder="How should we label your stats?">
            </div>
            ${renderFeedback()}
            <div class="actions">
                <button class="primary" id="create-button">Create</button>
                <button class="secondary" id="back-to-login-button">Back</button>
            </div>
        </section>
    `;

    document.getElementById("create-button").addEventListener("click", submitRegister);
    document.getElementById("back-to-login-button").addEventListener("click", () => {
        state.error = "";
        state.message = "";
        state.view = "login";
        render();
    });
}

function renderSaveTokenView() {
    app.innerHTML = `
        <section class="card stack">
            <div>
                <h2>Account created — save your access code</h2>
                <p class="small">You'll need this code to access your data on other devices. We cannot recover it if lost.</p>
            </div>
            <div>
                <label class="field-label" for="saved-token-box">Access code</label>
                <textarea id="saved-token-box" class="code-box" readonly></textarea>
            </div>
            ${renderFeedback()}
            <div class="actions">
                <button class="secondary" id="copy-token-button">Copy to clipboard</button>
                <button class="primary" id="confirm-token-button">I've saved it — continue</button>
            </div>
        </section>
    `;

    const tokenBox = document.getElementById("saved-token-box");
    tokenBox.value = state.pendingToken;

    document.getElementById("copy-token-button").addEventListener("click", async () => {
        await navigator.clipboard.writeText(state.pendingToken);
        state.message = "Access code copied.";
        state.error = "";
        render();
    });

    document.getElementById("confirm-token-button").addEventListener("click", () => {
        state.pendingToken = "";
        state.message = "";
        state.view = "settings";
        render();
    });
}

function renderSettingsView() {
    const session = state.session || {};
    const tokenDisplay = state.revealToken ? session.token : "•".repeat(64);

    app.innerHTML = `
        <section class="card stack">
            <div>
                <h2>Account settings</h2>
                <p class="small">Signed in as <strong>${escapeHtml(session.username || "Unknown user")}</strong>.</p>
            </div>
            <div class="stack">
                <div>
                    <label class="field-label" for="settings-username-input">Username</label>
                    <input id="settings-username-input" type="text" maxlength="100" value="${escapeAttribute(session.username || "")}">
                </div>
                <div class="actions">
                    <button class="primary" id="save-username-button">Save username</button>
                </div>
            </div>
            <div class="stack">
                <div class="field-label">Access code</div>
                <textarea id="settings-token-box" class="code-box ${state.revealToken ? "" : "hidden-token"}" readonly>${tokenDisplay}</textarea>
                <div class="inline">
                    <button class="secondary" id="toggle-token-button">${state.revealToken ? "Hide" : "Reveal"}</button>
                    <button class="secondary" id="copy-settings-token-button"${state.revealToken ? "" : " disabled"}>Copy</button>
                </div>
                <p class="small">You'll need this code to reconnect your stats on another device.</p>
            </div>
            ${renderFeedback()}
            <div class="actions">
                <button class="danger" id="logout-button">Log out</button>
                <button class="secondary" id="switch-account-button">Switch account</button>
            </div>
        </section>
    `;

    document.getElementById("save-username-button").addEventListener("click", saveUsername);
    document.getElementById("toggle-token-button").addEventListener("click", () => {
        state.revealToken = !state.revealToken;
        render();
    });
    document.getElementById("copy-settings-token-button").addEventListener("click", async () => {
        if (!state.revealToken) return;
        await navigator.clipboard.writeText(session.token || "");
        state.message = "Access code copied.";
        state.error = "";
        render();
    });
    document.getElementById("logout-button").addEventListener("click", logout);
    document.getElementById("switch-account-button").addEventListener("click", logout);
}

async function submitLogin() {
    const token = String(document.getElementById("token-input").value || "").replace(/\s+/g, "");
    if (!TOKEN_REGEX.test(token)) {
        state.error = "Access code must be 64 lowercase hex characters.";
        state.message = "";
        render();
        return;
    }

    try {
        const response = await fetch(USERS_LOGIN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        });

        if (response.status === 401) {
            state.error = "That access code was not recognized.";
            state.message = "";
            render();
            return;
        }

        if (!response.ok) {
            throw new Error(`Backend responded with ${response.status}`);
        }

        const data = await response.json();
        await persistSession({
            token,
            userId: data.userId,
            username: data.username,
        });

        state.error = "";
        state.message = "Signed in successfully.";
        state.view = "settings";
        render();
    } catch (error) {
        state.error = error.message;
        state.message = "";
        render();
    }
}

async function submitRegister() {
    const username = String(document.getElementById("username-input").value || "").trim();
    if (!username) {
        state.error = "Display name is required.";
        state.message = "";
        render();
        return;
    }

    const token = generateToken();

    try {
        const response = await fetch(USERS_REGISTER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, token }),
        });

        if (response.status === 409) {
            state.error = "That access code collided. Try creating the account again.";
            state.message = "";
            render();
            return;
        }

        if (!response.ok) {
            throw new Error(`Backend responded with ${response.status}`);
        }

        const data = await response.json();
        await persistSession({
            token,
            userId: data.userId,
            username: data.username,
        });

        state.pendingToken = token;
        state.error = "";
        state.message = "";
        state.view = "save-token";
        render();
    } catch (error) {
        state.error = error.message;
        state.message = "";
        render();
    }
}

async function saveUsername() {
    const username = String(document.getElementById("settings-username-input").value || "").trim();
    if (!username) {
        state.error = "Username is required.";
        state.message = "";
        render();
        return;
    }

    try {
        const response = await fetch(USERS_ME_URL, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${state.session.token}`,
            },
            body: JSON.stringify({ username }),
        });

        if (response.status === 401) {
            await handleUnauthorized();
            return;
        }

        if (!response.ok) {
            throw new Error(`Backend responded with ${response.status}`);
        }

        const data = await response.json();
        await persistSession({
            ...state.session,
            username: data.username,
            userId: data.userId,
        });

        state.error = "";
        state.message = "Username updated.";
        render();
    } catch (error) {
        state.error = error.message;
        state.message = "";
        render();
    }
}

async function logout() {
    await sendRuntimeMessage({ type: "LOG_OUT" });
    state.session = null;
    state.pendingToken = "";
    state.revealToken = false;
    state.message = "";
    state.error = "";
    state.view = "login";
    render();
}

async function handleUnauthorized() {
    await sendRuntimeMessage({ type: "HANDLE_UNAUTHORIZED" });
    state.session = null;
    state.pendingToken = "";
    state.revealToken = false;
    state.message = "";
    state.error = "Your access code is no longer valid. Please sign in again.";
    state.view = "login";
    render();
}

async function persistSession(session) {
    state.session = session;
    await chrome.storage.local.set({ [USER_SESSION_KEY]: session });
    await sendRuntimeMessage({ type: "SET_USER_SESSION", session });
}

function getStoredSession() {
    return new Promise((resolve) => {
        chrome.storage.local.get(USER_SESSION_KEY, (result) => {
            resolve(result[USER_SESSION_KEY] || null);
        });
    });
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(response);
        });
    });
}

function generateToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function renderFeedback() {
    const parts = [];
    if (state.error) parts.push(`<div class="error">${escapeHtml(state.error)}</div>`);
    if (state.message) parts.push(`<div class="success">${escapeHtml(state.message)}</div>`);
    return parts.join("");
}

function renderFatal(message) {
    app.innerHTML = `<section class="card"><p class="error">${escapeHtml(message)}</p></section>`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
    return escapeHtml(value);
}
