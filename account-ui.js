const USERS_LOGIN_URL = "http://34.207.146.239/api/users/login";
const USERS_REGISTER_URL = "http://34.207.146.239/api/users/register";
const USERS_ME_URL = "http://34.207.146.239/api/users/me";
const TOKEN_REGEX = /^[0-9a-f]{64}$/;

const page = document.body.dataset.page;

const state = {
    session: null,
    pendingSession: null,
    revealToken: false,
    feedback: "",
    feedbackType: "",
};

init().catch((error) => {
    showFeedback(error.message, "error");
});

async function init() {
    state.session = await sendRuntimeMessage({ type: "GET_USER_SESSION" }).then((result) => result?.session || null);

    if (page === "signin" && state.session?.token) {
        redirectTo("account.html");
        return;
    }

    if (page === "account" && !state.session?.token) {
        redirectTo("signin.html");
        return;
    }

    bindPage();

    if (page === "account" && new URLSearchParams(window.location.search).get("signedIn") === "1") {
        showFeedback("Signed in successfully.", "success");
    }
}

function bindPage() {
    if (page === "signin") {
        bindSigninPage();
        return;
    }

    if (page === "create") {
        bindCreatePage();
        return;
    }

    if (page === "account") {
        bindAccountPage();
    }
}

function bindSigninPage() {
    const form = document.getElementById("signin-form");
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        showFeedback("", "");

        const token = String(document.getElementById("access-code").value || "").replace(/\s+/g, "");
        const remember = Boolean(document.getElementById("remember-me")?.checked);

        if (!TOKEN_REGEX.test(token)) {
            showFeedback("Access code must be 64 lowercase hex characters.", "error");
            return;
        }

        try {
            const response = await fetch(USERS_LOGIN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });

            if (response.status === 401) {
                showFeedback("That access code was not recognized.", "error");
                return;
            }

            if (!response.ok) {
                throw new Error(`Backend responded with ${response.status}`);
            }

            const data = await response.json();
            const session = {
                token,
                userId: data.userId,
                username: data.username,
            };

            await persistSession(session, remember);
            redirectTo("account.html?signedIn=1");
        } catch (error) {
            showFeedback(error.message === "Failed to fetch"
                ? "Could not reach the backend. Please try again in a moment."
                : error.message, "error");
        }
    });
}

function bindCreatePage() {
    const form = document.getElementById("create-form");
    const copyButton = document.getElementById("copy-code");
    const downloadButton = document.getElementById("download-code");
    const continueButton = document.getElementById("continue-account");

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        showFeedback("", "");

        const username = String(document.getElementById("username").value || "").trim();
        if (!username) {
            showFeedback("Username is required.", "error");
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
                showFeedback("Code generation collided. Please try again.", "error");
                return;
            }

            if (!response.ok) {
                throw new Error(`Backend responded with ${response.status}`);
            }

            const data = await response.json();
            state.pendingSession = {
                token,
                userId: data.userId,
                username: data.username,
            };

            populateGeneratedCode(state.pendingSession);
            copyButton.disabled = false;
            downloadButton.disabled = false;
            continueButton.hidden = false;
            document.querySelector(".step-num.pending")?.classList.remove("pending");
            showFeedback("Access code generated. Save it before continuing.", "success");
        } catch (error) {
            showFeedback(error.message === "Failed to fetch"
                ? "Could not reach the backend. Please try again in a moment."
                : error.message, "error");
        }
    });

    copyButton?.addEventListener("click", async () => {
        if (!state.pendingSession?.token) return;
        await navigator.clipboard.writeText(state.pendingSession.token);
        showFeedback("Access code copied.", "success");
    });

    downloadButton?.addEventListener("click", () => {
        if (!state.pendingSession?.token) return;
        downloadAccessCode(state.pendingSession);
        showFeedback("Access code downloaded.", "success");
    });

    continueButton?.addEventListener("click", async () => {
        if (!state.pendingSession) return;
        await persistSession(state.pendingSession, true);
        redirectTo("account.html?signedIn=1");
    });
}

function bindAccountPage() {
    const usernameInput = document.getElementById("username");
    const codeBox = document.getElementById("access-code-box");
    const signedInAs = document.getElementById("signed-in-as");
    const heroTagline = document.getElementById("account-illus-copy");

    if (usernameInput) {
        usernameInput.value = state.session?.username || "";
    }

    if (signedInAs) {
        signedInAs.textContent = state.session?.username || "Unknown user";
    }

    if (heroTagline) {
        heroTagline.textContent = state.session?.username
            ? `Welcome back, ${state.session.username}. Your feeds are running warm today.`
            : "Welcome back. Your feeds are running warm today.";
    }

    renderAccountCodeBox(codeBox);

    document.getElementById("save-username")?.addEventListener("click", async () => {
        const username = String(usernameInput?.value || "").trim();
        if (!username) {
            showFeedback("Username is required.", "error");
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
            state.session = {
                ...state.session,
                username: data.username,
                userId: data.userId,
            };
            await persistSession(state.session, true);
            signedInAs.textContent = data.username;
            showFeedback("Username updated.", "success");
        } catch (error) {
            showFeedback(error.message, "error");
        }
    });

    document.getElementById("toggle-code")?.addEventListener("click", () => {
        state.revealToken = !state.revealToken;
        renderAccountCodeBox(codeBox);
        document.getElementById("toggle-code").textContent = state.revealToken ? "Hide" : "Reveal";
    });

    document.getElementById("copy-code")?.addEventListener("click", async () => {
        if (!state.session?.token) return;
        await navigator.clipboard.writeText(state.session.token);
        showFeedback("Access code copied.", "success");
    });

    document.getElementById("logout")?.addEventListener("click", logoutToSignin);
    document.getElementById("switch-account")?.addEventListener("click", logoutToSignin);
}

function renderAccountCodeBox(codeBox) {
    if (!codeBox) return;

    const visible = state.revealToken;
    codeBox.textContent = visible ? state.session?.token || "" : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••";
    codeBox.classList.toggle("masked", !visible);
    codeBox.setAttribute("aria-label", visible ? "Your access code, currently revealed" : "Your access code, currently hidden");
}

function populateGeneratedCode(session) {
    const placeholder = document.getElementById("generated-code");
    if (!placeholder) return;

    placeholder.className = "code-box";
    placeholder.textContent = session.token;
}

async function logoutToSignin() {
    await sendRuntimeMessage({ type: "LOG_OUT" });
    redirectTo("signin.html");
}

async function handleUnauthorized() {
    await sendRuntimeMessage({ type: "HANDLE_UNAUTHORIZED" });
    redirectTo("signin.html");
}

async function persistSession(session, persist) {
    state.session = session;
    await sendRuntimeMessage({ type: "SET_USER_SESSION", session, persist });
}

function showFeedback(message, type) {
    state.feedback = message;
    state.feedbackType = type;

    const feedbackNodes = document.querySelectorAll("[data-feedback]");
    for (const node of feedbackNodes) {
        node.textContent = message || "";
        node.className = "feedback";
        if (type === "error") {
            node.classList.add("text-danger");
        } else if (type === "success") {
            node.classList.add("text-success");
        }
    }
}

function redirectTo(path) {
    window.location.href = chrome.runtime.getURL(path);
}

function generateToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function downloadAccessCode(session) {
    const content = `Username: ${session.username}\nAccess code: ${session.token}\n\nKeep this safe — it's the only way to restore your stats.`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "feeds_temperature_access_code.txt";
    link.click();
    URL.revokeObjectURL(url);
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response || null);
        });
    });
}
