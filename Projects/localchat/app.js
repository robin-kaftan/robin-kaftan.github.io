let currentUser = localStorage.getItem("localchat_username") || "";
let peer = null;
let activeConnections = [];
let hostConnection = null;
let isHost = false;
let currentRoomInfo = { name: "", creator: "", password: "" };
let currentRoomUsers = [];

// File limit set to 25MB (25 * 1024 * 1024 bytes)
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const RATE_LIMIT_MS = 200;

const SOUNDS = {
    received: "./Resources/Sounds/message-recieved.wav",
    sent: "./Resources/Sounds/message-sent.wav",
    sendFail: "./Resources/Sounds/message-send-fail.wav",
    connectFail: "./Resources/Sounds/connect-fail.wav",
    connectSuccess: "./Resources/Sounds/connect-success.wav",
    userEntered: "./Resources/Sounds/user-entered.wav",
    userMentioned: "./Resources/Sounds/user-mentioned.wav"
};

function playSFX(soundPath) {
    try {
        const audio = new Audio(soundPath);
        audio.play().catch(() => {
            const fileName = soundPath.split("/").pop();
            console.warn(`sfx not found: ${fileName}`);
        });
    } catch (err) {
        const fileName = soundPath.split("/").pop();
        console.warn(`sfx not found: ${fileName}`);
    }
}

function escapeHTML(str) {
    if (typeof str !== "string") return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function sanitizeUsername(username) {
    if (typeof username !== "string") return "Anonymous";
    return escapeHTML(username.trim()).slice(0, 25);
}

// Map a Room Name directly to a deterministic Peer ID
function formatRoomPeerId(name) {
    const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9]/g, '-');
    return `localchat-room-${cleanName}`;
}

const navButtons = document.getElementById("navButtons");
const homepageRedirect = document.getElementById("homepageRedirect");
const settingsRedirect = document.getElementById("settingsRedirect");
const hostRoomRedirect = document.getElementById("hostRoomRedirect");

const notificationFrame = document.getElementById("notificationFrame");
const notificationTitle = notificationFrame ? notificationFrame.querySelector("h1") : null;
const notificationText = notificationFrame ? notificationFrame.querySelector("p") : null;
const notificationInput = document.getElementById("notificationInput");
const notificationButton = document.getElementById("notificationButton");

const initialisationPage = document.getElementById("initialisationPage");
const firstTimeWelcome = document.getElementById("firstTimeWelcome");
const notFirstTimeWelcome = document.getElementById("notFirstTimeWelcome");
const usernameInput = document.getElementById("usernameInput");
const submitUsername = document.getElementById("submitUsername");

const homepage = document.getElementById("homepage");
const homepageRoomSearchBox = document.getElementById("homepageRoomSearchBox");
const templateRoomCard = document.getElementById("templateRoomCard");
const searchingForRoomsText = document.getElementById("searchingForRoomsText");
const timeSpentSearching = document.getElementById("timeSpentSearching");

const hostRoomSection = document.getElementById("hostRoom");
const roomNameInput = document.getElementById("roomNameInput");
const roomPasswordInput = document.getElementById("roomPasswordInput");
const submitRoomHost = document.getElementById("submitRoomHost");

const roomSection = document.getElementById("room");
const roomNameDisplay = document.getElementById("room-name-display");
const roomUsersList = document.getElementById("room-users-list");
const messagesContainer = document.getElementById("messagesContainer");
const templateMessageEntry = document.getElementById("templateMessageEntry");
const messageInputBox = document.getElementById("messageInputBox");
const messageSendButton = document.getElementById("messageSendButton");
const fileAddButton = document.getElementById("fileAddButton");

function showNotification({ title, text, showInput = false, placeholder = "Enter value...", buttonText = "OK" }) {
    return new Promise((resolve) => {
        if (!notificationFrame) {
            if (showInput) resolve(prompt(text));
            else { alert(`${title}\n${text}`); resolve(true); }
            return;
        }

        if (notificationTitle) notificationTitle.innerText = title;
        if (notificationText) notificationText.innerText = text;
        if (notificationButton) notificationButton.innerText = buttonText;

        if (notificationInput) {
            if (showInput) {
                notificationInput.hidden = false;
                notificationInput.value = "";
                notificationInput.placeholder = placeholder;
                setTimeout(() => notificationInput.focus(), 50);
            } else {
                notificationInput.hidden = true;
            }
        }

        notificationFrame.hidden = false;

        const handleConfirm = () => {
            notificationFrame.hidden = true;
            notificationButton.removeEventListener("click", handleConfirm);
            if (notificationInput) notificationInput.removeEventListener("keypress", handleKeyPress);
            
            if (showInput) {
                resolve(notificationInput.value.trim());
            } else {
                resolve(true);
            }
        };

        const handleKeyPress = (e) => {
            if (e.key === "Enter") handleConfirm();
        };

        notificationButton.onclick = handleConfirm;
        if (notificationInput && showInput) {
            notificationInput.onkeypress = handleKeyPress;
        }
    });
}

const hiddenFileInput = document.createElement("input");
hiddenFileInput.type = "file";
hiddenFileInput.style.display = "none";
document.body.appendChild(hiddenFileInput);

const msgBoxContainer = document.querySelector(".msgbox");
const inputHighlightOverlay = document.createElement("div");
inputHighlightOverlay.id = "inputHighlightOverlay";

if (msgBoxContainer && messageInputBox) {
    msgBoxContainer.insertBefore(inputHighlightOverlay, messageInputBox);
}

function syncInputOverlay() {
    if (!messageInputBox || !inputHighlightOverlay) return;
    
    const style = window.getComputedStyle(messageInputBox);
    inputHighlightOverlay.style.left = messageInputBox.offsetLeft + "px";
    inputHighlightOverlay.style.top = messageInputBox.offsetTop + "px";
    inputHighlightOverlay.style.width = messageInputBox.offsetWidth + "px";
    inputHighlightOverlay.style.height = messageInputBox.offsetHeight + "px";
    inputHighlightOverlay.style.padding = style.padding;
    inputHighlightOverlay.style.font = style.font;
    inputHighlightOverlay.style.lineHeight = style.lineHeight;

    let text = escapeHTML(messageInputBox.value);

    currentRoomUsers.forEach(user => {
        const safeUser = escapeHTML(user);
        const mentionTag = `@${safeUser}`;
        if (text.includes(mentionTag)) {
            const highlighted = `<span style="color: var(--accent); font-weight: bold;">${mentionTag}</span>`;
            text = text.split(mentionTag).join(highlighted);
        }
    });

    inputHighlightOverlay.innerHTML = text;
    inputHighlightOverlay.scrollLeft = messageInputBox.scrollLeft;
}

if (messageInputBox) {
    messageInputBox.addEventListener("input", syncInputOverlay);
    messageInputBox.addEventListener("scroll", () => {
        if (inputHighlightOverlay) inputHighlightOverlay.scrollLeft = messageInputBox.scrollLeft;
    });
}

function getFibonacciSequence(length) {
    let seq = [1, 1];
    while (seq.length < length) {
        seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
    }
    return seq.slice(0, length);
}

function generateKeyStream(roomName, length) {
    if (!roomName) roomName = "default";
    const fib = getFibonacciSequence(roomName.length);
    let keyStream = [];
    for (let i = 0; i < roomName.length; i++) {
        keyStream.push((roomName.charCodeAt(i) * fib[i]) % 256);
    }
    let fullStream = [];
    for (let i = 0; i < length; i++) {
        fullStream.push(keyStream[i % keyStream.length]);
    }
    return fullStream;
}

function cipherTransform(text, roomName) {
    const keyStream = generateKeyStream(roomName, text.length);
    let result = "";
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ keyStream[i]);
    }
    return result;
}

function encryptText(text) {
    return btoa(cipherTransform(text, currentRoomInfo.name));
}

function decryptText(cipherText) {
    try {
        const raw = atob(cipherText);
        return cipherTransform(raw, currentRoomInfo.name);
    } catch (e) {
        return cipherText;
    }
}

function showSection(sectionToShow) {
    [initialisationPage, homepage, hostRoomSection, roomSection].forEach(sec => sec.hidden = true);
    sectionToShow.hidden = false;
}

function initApp() {
    if (currentUser) {
        firstTimeWelcome.hidden = true;
        notFirstTimeWelcome.hidden = false;
        usernameInput.value = currentUser;
        navButtons.style.display = "flex";
    }
    showSection(initialisationPage);
}

submitUsername.addEventListener("click", async () => {
    const val = sanitizeUsername(usernameInput.value);
    if (!val) {
        await showNotification({
            title: "Validation Error",
            text: "Please enter a valid username."
        });
        return;
    }
    
    currentUser = val;
    localStorage.setItem("localchat_username", currentUser);
    
    navButtons.style.display = "flex";
    initPeer();
    showSection(homepage);
});

function initPeer(customPeerId = null) {
    if (peer) {
        try { 
            peer.off();
            peer.destroy(); 
        } catch(e) {}
    }

    const peerOptions = {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    };

    peer = customPeerId ? new Peer(customPeerId, peerOptions) : new Peer(peerOptions);

    peer.on("connection", (conn) => {
        conn.lastMessageTime = 0;
        conn.authenticated = false;

        conn.on("data", (data) => handleIncomingData(conn, data));
        conn.on("close", () => handleClientDisconnect(conn));
        conn.on("error", () => handleClientDisconnect(conn));
    });

    peer.on("error", (err) => {
        playSFX(SOUNDS.connectFail);
        if (err.type === "unavailable-id") {
            showNotification({
                title: "Room Taken",
                text: "A room with this name is already active online."
            });
        }
    });
}

homepageRedirect.addEventListener("click", () => leaveOrDisbandRoom());
settingsRedirect.addEventListener("click", () => {
    leaveOrDisbandRoom();
    firstTimeWelcome.hidden = true;
    notFirstTimeWelcome.hidden = false;
    showSection(initialisationPage);
});
hostRoomRedirect.addEventListener("click", () => {
    leaveOrDisbandRoom();
    showSection(hostRoomSection);
});

submitRoomHost.addEventListener("click", async () => {
    const rawName = escapeHTML(roomNameInput.value.trim()).slice(0, 30);
    if (!rawName) {
        await showNotification({
            title: "Validation Error",
            text: "Please enter a valid room name."
        });
        return;
    }

    const targetPeerId = formatRoomPeerId(rawName);

    initPeer(targetPeerId);

    peer.on("open", () => {
        isHost = true;
        currentRoomInfo = {
            name: rawName,
            creator: currentUser,
            password: roomPasswordInput.value.trim()
        };

        setupRoomUI(currentRoomInfo.name, [currentUser]);
        showSection(roomSection);
        playSFX(SOUNDS.connectSuccess);
    });
});

// -------------------------------------------------------------
// ISOLATED SEARCH PROBING ARCHITECTURE
// -------------------------------------------------------------
let searchDebounce = null;
let searchTimerInterval = null;
let searchSeconds = 0;
let activeSearchPeer = null;

homepageRoomSearchBox.addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    clearInterval(searchTimerInterval);
    
    const query = e.target.value.trim();

    const existingCards = homepage.querySelectorAll(".generated-room-card");
    existingCards.forEach(card => card.remove());

    if (!query) {
        if (searchingForRoomsText) searchingForRoomsText.hidden = true;
        return;
    }

    const targetPeerId = formatRoomPeerId(query);
    if (peer && peer.id === targetPeerId) {
        if (searchingForRoomsText) searchingForRoomsText.hidden = true;
        return;
    }

    searchSeconds = 0;
    if (timeSpentSearching) timeSpentSearching.innerText = "0";
    if (searchingForRoomsText) searchingForRoomsText.hidden = false;

    searchTimerInterval = setInterval(() => {
        searchSeconds++;
        if (timeSpentSearching) timeSpentSearching.innerText = searchSeconds;
    }, 1000);

    // 600ms Debounce to prevent signaling flood while typing
    searchDebounce = setTimeout(() => {
        performPeerSearch(query);
    }, 600);
});

function performPeerSearch(roomName) {
    const targetPeerId = formatRoomPeerId(roomName);

    if (activeSearchPeer) {
        try { activeSearchPeer.destroy(); } catch(e) {}
    }

    // Dedicated secondary peer instance for search probing
    activeSearchPeer = new Peer({ debug: 0 });

    activeSearchPeer.on("open", () => {
        const conn = activeSearchPeer.connect(targetPeerId, { reliable: false });
        let found = false;

        conn.on("open", () => {
            found = true;
            conn.send({ type: "INFO_REQUEST" });
        });

        conn.on("data", (data) => {
            if (data.type === "INFO_RESPONSE") {
                clearInterval(searchTimerInterval);
                if (searchingForRoomsText) searchingForRoomsText.hidden = true;

                renderRoomCard(data.roomName, data.creator, data.hasPassword, targetPeerId);

                try { conn.close(); } catch(e){}
                if (activeSearchPeer) activeSearchPeer.destroy();
            }
        });

        setTimeout(() => {
            if (!found) {
                clearInterval(searchTimerInterval);
                if (searchingForRoomsText) searchingForRoomsText.hidden = true;
                try { conn.close(); } catch(e){}
                if (activeSearchPeer) activeSearchPeer.destroy();
            }
        }, 1500);
    });

    activeSearchPeer.on("error", () => {
        clearInterval(searchTimerInterval);
        if (searchingForRoomsText) searchingForRoomsText.hidden = true;
        if (activeSearchPeer) activeSearchPeer.destroy();
    });
}

function renderRoomCard(roomName, creator, hasPassword, peerId) {
    const existing = document.getElementById(`room-card-${peerId}`);
    if (existing) return;

    const card = templateRoomCard.cloneNode(true);
    card.id = `room-card-${peerId}`;
    card.classList.add("generated-room-card");
    card.hidden = false;

    card.querySelector("#roomTitle").innerText = roomName;
    card.querySelector("#rooomCreator").innerText = creator;
    
    const pswdTag = card.querySelector("#roomPasswordRequired");
    if (!hasPassword && pswdTag) {
        pswdTag.style.display = "none";
    }

    const joinBtn = card.querySelector("#joinRoomButton");
    joinBtn.addEventListener("click", () => joinRoomByPeerId(peerId, roomName, hasPassword));

    homepage.appendChild(card);
}

async function joinRoomByPeerId(targetPeerId, roomName, checkPassword = false) {
    let inputPswd = "";

    if (checkPassword) {
        inputPswd = await showNotification({
            title: "Protected Room",
            text: `Enter password for "${roomName}":`,
            showInput: true,
            placeholder: "Enter Password...",
            buttonText: "Join Room"
        });
        
        if (inputPswd === null) return;
    }

    currentRoomInfo = { name: roomName, creator: "", password: inputPswd };
    hostConnection = peer.connect(targetPeerId);
    
    hostConnection.on("open", () => {
        hostConnection.send({ 
            type: "JOIN", 
            username: currentUser, 
            password: inputPswd 
        });
    });

    hostConnection.on("error", () => playSFX(SOUNDS.connectFail));
    hostConnection.on("data", (data) => handleIncomingData(hostConnection, data));
    hostConnection.on("close", () => {
        cleanupRoomState();
        showSection(homepage);
    });
}

function formatMessageContent(rawText, sender) {
    let text = escapeHTML(rawText);
    let isMentioned = false;

    currentRoomUsers.forEach(user => {
        const safeUser = escapeHTML(user);
        const mentionTag = `@${safeUser}`;
        if (text.includes(mentionTag)) {
            const highlighted = `<span style="color: var(--accent); font-weight: bold;">${mentionTag}</span>`;
            text = text.split(mentionTag).join(highlighted);
            
            if (user === currentUser && sender !== currentUser) {
                isMentioned = true;
            }
        }
    });

    return { formattedText: text, isMentioned };
}

async function handleIncomingData(conn, data) {
    if (!data || typeof data !== "object" || !data.type) return;

    // HOST SIDE: Handle search probes quickly without socket pollution
    if (data.type === "INFO_REQUEST" && isHost) {
        conn.send({
            type: "INFO_RESPONSE",
            roomName: currentRoomInfo.name,
            creator: currentRoomInfo.creator,
            hasPassword: !!currentRoomInfo.password
        });
        setTimeout(() => { try { conn.close(); } catch(e){} }, 100);
        return;
    }

    const now = Date.now();
    if (conn.lastMessageTime && now - conn.lastMessageTime < RATE_LIMIT_MS) {
        return;
    }
    conn.lastMessageTime = now;

    if (data.type === "JOIN") {
        if (isHost) {
            if (currentRoomInfo.password && data.password !== currentRoomInfo.password) {
                conn.send({ type: "AUTH_FAILED", reason: "Incorrect room password." });
                setTimeout(() => conn.close(), 200);
                return;
            }

            const cleanUser = sanitizeUsername(data.username);
            conn.username = cleanUser;
            conn.authenticated = true;
            activeConnections.push(conn);

            const users = [currentUser, ...activeConnections.map(c => c.username)];
            conn.send({ type: "JOIN_SUCCESS", roomName: currentRoomInfo.name, users: users });
            
            broadcastUserList();
            broadcastSystemMessage(`${cleanUser} joined the room.`);
        }
        return;
    }

    if (data.type === "AUTH_FAILED") {
        playSFX(SOUNDS.connectFail);
        await showNotification({
            title: "Access Denied",
            text: data.reason || "Authentication failed."
        });
        cleanupRoomState();
        showSection(homepage);
        return;
    }

    if (data.type === "JOIN_SUCCESS") {
        const sanitizedUsers = Array.isArray(data.users) ? data.users.map(u => sanitizeUsername(u)) : [currentUser];
        setupRoomUI(data.roomName, sanitizedUsers);
        showSection(roomSection);
        playSFX(SOUNDS.connectSuccess);
        return;
    }

    if (isHost && !conn.authenticated) {
        return;
    }

    if (data.type === "MSG") {
        if (typeof data.payload !== "string" || typeof data.sender !== "string") return;

        const cleanSender = sanitizeUsername(data.sender);
        const decryptedMsg = decryptText(data.payload);
        const { formattedText, isMentioned } = formatMessageContent(decryptedMsg, cleanSender);
        
        appendMessage(cleanSender, formattedText, true);

        if (isMentioned) {
            playSFX(SOUNDS.userMentioned);
        } else if (cleanSender !== "System") {
            playSFX(SOUNDS.received);
        }

        if (isHost) {
            const sanitizedRelay = {
                type: "MSG",
                sender: cleanSender,
                payload: data.payload
            };
            activeConnections.forEach(c => {
                if (c !== conn && c.authenticated) c.send(sanitizedRelay);
            });
        }
    } else if (data.type === "FILE") {
        if (!data.fileBuffer || !(data.fileBuffer instanceof ArrayBuffer)) return;
        if (data.fileBuffer.byteLength > MAX_FILE_SIZE_BYTES) return;

        const cleanSender = sanitizeUsername(data.sender);
        const decryptedFileName = escapeHTML(decryptText(data.fileName));
        
        appendFileMessage(cleanSender, decryptedFileName, data.fileBuffer, data.fileType);
        playSFX(SOUNDS.received);
        
        if (isHost) {
            const sanitizedFileRelay = {
                type: "FILE",
                sender: cleanSender,
                fileName: data.fileName,
                fileType: escapeHTML(data.fileType),
                fileBuffer: data.fileBuffer
            };
            activeConnections.forEach(c => {
                if (c !== conn && c.authenticated) c.send(sanitizedFileRelay);
            });
        }
    } else if (data.type === "USER_LIST") {
        if (Array.isArray(data.users)) {
            const sanitizedUsers = data.users.map(u => sanitizeUsername(u));
            updateUsersUI(sanitizedUsers);
        }
    } else if (data.type === "DISBAND") {
        playSFX(SOUNDS.connectFail);
        await showNotification({
            title: "Room Disbanded",
            text: "The host has closed this room."
        });
        cleanupRoomState();
        showSection(homepage);
    }
}

function handleClientDisconnect(conn) {
    activeConnections = activeConnections.filter(c => c !== conn);
    
    if (isHost) {
        if (activeConnections.length === 0) {
            disbandRoom();
        } else {
            broadcastUserList();
            if (conn.username) broadcastSystemMessage(`${conn.username} left the room.`);
        }
    }
}

function leaveOrDisbandRoom() {
    if (isHost) {
        disbandRoom();
    } else if (hostConnection) {
        hostConnection.close();
        cleanupRoomState();
        showSection(homepage);
    }
}

function disbandRoom() {
    if (isHost) {
        activeConnections.forEach(c => {
            if (c.authenticated) c.send({ type: "DISBAND" });
        });
    }
    cleanupRoomState();
    showSection(homepage);
}

window.addEventListener("beforeunload", () => {
    leaveOrDisbandRoom();
});

function cleanupRoomState() {
    isHost = false;
    activeConnections = [];
    hostConnection = null;
    currentRoomUsers = [];
    messagesContainer.innerHTML = "";
    messagesContainer.appendChild(templateMessageEntry);
    if (inputHighlightOverlay) inputHighlightOverlay.innerHTML = "";
    initPeer();
}

function broadcastUserList() {
    const users = [currentUser, ...activeConnections.map(c => c.username)];
    updateUsersUI(users);
    activeConnections.forEach(c => {
        if (c.authenticated) c.send({ type: "USER_LIST", users });
    });
}

function broadcastSystemMessage(text) {
    const cleanText = escapeHTML(text);
    const encryptedText = encryptText(cleanText);
    const msgData = { type: "MSG", sender: "System", payload: encryptedText };
    const { formattedText } = formatMessageContent(cleanText, "System");
    appendMessage("System", formattedText, true);
    if (isHost) {
        activeConnections.forEach(c => {
            if (c.authenticated) c.send(msgData);
        });
    }
}

function broadcastTextMessage(text) {
    try {
        const cleanText = text.trim();
        if (!cleanText) return;

        const encryptedText = encryptText(cleanText);
        const msgData = { type: "MSG", sender: currentUser, payload: encryptedText };
        
        const { formattedText } = formatMessageContent(cleanText, currentUser);
        appendMessage(currentUser, formattedText, true);
        playSFX(SOUNDS.sent);

        if (isHost) {
            activeConnections.forEach(c => {
                if (c.authenticated) c.send(msgData);
            });
        } else if (hostConnection) {
            hostConnection.send(msgData);
        }
    } catch (e) {
        playSFX(SOUNDS.sendFail);
    }
}

fileAddButton.addEventListener("click", () => hiddenFileInput.click());

hiddenFileInput.addEventListener("change", () => {
    const file = hiddenFileInput.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
        const maxMB = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
        showNotification({
            title: "File Too Large",
            text: `File size exceeds the maximum limit of ${maxMB}MB.`
        });
        hiddenFileInput.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const buffer = e.target.result;
            const cleanFileName = escapeHTML(file.name);
            const encryptedFileName = encryptText(cleanFileName);
            
            const filePayload = {
                type: "FILE",
                sender: currentUser,
                fileName: encryptedFileName,
                fileType: escapeHTML(file.type),
                fileBuffer: buffer
            };

            appendFileMessage(currentUser, cleanFileName, buffer, file.type);
            playSFX(SOUNDS.sent);

            if (isHost) {
                activeConnections.forEach(c => {
                    if (c.authenticated) c.send(filePayload);
                });
            } else if (hostConnection) {
                hostConnection.send(filePayload);
            }
        } catch(err) {
            playSFX(SOUNDS.sendFail);
        }
    };
    reader.onerror = () => playSFX(SOUNDS.sendFail);
    reader.readAsArrayBuffer(file);
    hiddenFileInput.value = "";
});

function setupRoomUI(roomName, users) {
    roomNameDisplay.innerText = roomName;
    updateUsersUI(users);
}

function updateUsersUI(users) {
    if (users.length > currentRoomUsers.length && currentRoomUsers.length > 0) {
        playSFX(SOUNDS.userEntered);
    }
    
    currentRoomUsers = users;
    roomUsersList.innerHTML = "";
    users.forEach(user => {
        const li = document.createElement("li");
        li.innerText = user;
        roomUsersList.appendChild(li);
    });
    
    syncInputOverlay();
}

function appendMessage(sender, textHTML, isFormatted = false) {
    const msgNode = templateMessageEntry.cloneNode(true);
    msgNode.removeAttribute("id");
    msgNode.hidden = false;
    msgNode.classList.add("fade-in");
    msgNode.querySelector("#messageComposer").innerText = sender;
    
    const content = msgNode.querySelector("#messageContent");
    if (isFormatted) {
        content.innerHTML = textHTML;
    } else {
        content.innerText = textHTML;
    }
    
    messagesContainer.appendChild(msgNode);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function appendFileMessage(sender, fileName, buffer, fileType) {
    const safeType = escapeHTML(fileType) || "application/octet-stream";
    const blob = new Blob([buffer], { type: safeType });
    const url = URL.createObjectURL(blob);
    const sizeStr = formatBytes(buffer.byteLength);
    
    const msgNode = templateMessageEntry.cloneNode(true);
    msgNode.removeAttribute("id");
    msgNode.hidden = false;
    msgNode.classList.add("fade-in");
    msgNode.querySelector("#messageComposer").innerText = sender;
    
    const safeFileName = escapeHTML(fileName);
    const content = msgNode.querySelector("#messageContent");
    content.innerHTML = `Shared a file (${sizeStr}): <a href="${url}" download="${safeFileName}" style="color: var(--accent, #007bff); text-decoration: underline;">${safeFileName}</a>`;
    
    messagesContainer.appendChild(msgNode);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendMessage() {
    const text = messageInputBox.value.trim();
    if (!text) return;
    broadcastTextMessage(text);
    messageInputBox.value = "";
    syncInputOverlay();
}

messageSendButton.addEventListener("click", sendMessage);
messageInputBox.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

initApp();