let currentUser = "";
let currentRoom = "";
let isHost = false;
let peer = null;
let connections = [];
let hostConn = null;
let roomUsers = [];
let roomHistory = [];
let cryptoKey = null;

let replyingToMsg = null;

const RAM_LIMIT_BYTES = 400 * 1024 * 1024;

let pinnedRooms = JSON.parse(localStorage.getItem('pinnedRooms') || '[]');
let pinnedStatuses = {};
let pinMonitorPeer = null;

function formatChatMessage(rawText) {
    if (!rawText) return '';

    let text = rawText.trim();

    // Step 1: If wrapped in < ... >, strip outer brackets and CANCEL all formatting inside
    if (text.startsWith('<') && text.endsWith('>')) {
        return text.substring(1, text.length - 1)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // Step 2: Escape HTML special characters to prevent XSS
    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Step 3: Parse custom formatting tags
    // ***text*** -> <i><b>text</b></i>
    text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<i><b>$1</b></i>');

    // **text** -> <i>text</i>
    text = text.replace(/\*\*(.*?)\*\*/g, '<i>$1</i>');

    // *text* -> <b>text</b>
    text = text.replace(/\*(.*?)\*/g, '<b>$1</b>');

    // _text_ -> <span class="darkgreen">text</span>
    text = text.replace(/_(.*?)_/g, '<span class="darkgreen">$1</span>');

    return text;
}

async function deriveCryptoKey(roomId) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(roomId),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode("roomchat_static_salt_" + roomId),
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptData(dataObject) {
    if (!cryptoKey) return dataObject;
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const jsonString = JSON.stringify(dataObject);
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        enc.encode(jsonString)
    );
    return {
        encrypted: true,
        iv: Array.from(iv),
        payload: ciphertext
    };
}

async function decryptData(packet) {
    if (!packet || !packet.encrypted || !cryptoKey) return packet;
    const dec = new TextDecoder();
    const iv = new Uint8Array(packet.iv);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        packet.payload
    );
    return JSON.parse(dec.decode(decryptedBuffer));
}

async function sendEncrypted(conn, dataObject) {
    try {
        const encryptedPacket = await encryptData(dataObject);
        conn.send(encryptedPacket);
    } catch (err) {
        console.error("Encryption error:", err);
    }
}

function playSFX(filename) {
    try {
        const audio = new Audio(`./Resources/sfx/${filename}`);
        audio.play().catch(() => { });
    } catch (err) { }
}

function playMessageSFX() {
    const isRare = Math.floor(Math.random() * 10000) === 0;
    if (isRare) {
        playSFX('mail.mp3');
    } else {
        playSFX('message.wav');
    }
}

function updateFavicon(themeNumber) {
    let favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
    }
    favicon.type = 'image/png';
    favicon.href = `./Resources/theme-${themeNumber}.png`;
}

function setInputsDisabled(disabled) {
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => input.disabled = disabled);
}

function checkAndTrimMemory() {
    if (window.performance && window.performance.memory) {
        const usedHeap = window.performance.memory.usedJSHeapSize;
        if (usedHeap >= RAM_LIMIT_BYTES) {
            trimOldMessages();
        }
    }
}

function trimOldMessages() {
    const msgContainer = document.getElementById('msgContainer');
    const messages = Array.from(msgContainer.querySelectorAll('.message:not(#templateMessageEntry)'));

    const targetTrimCount = Math.max(0, messages.length - 20);
    const toRemoveCount = Math.min(15, targetTrimCount);

    for (let i = 0; i < toRemoveCount; i++) {
        if (replyingToMsg && messages[i].dataset.msgId === replyingToMsg.msgId) {
            clearReplyTarget();
        }
        messages[i].remove();
    }

    if (isHost && roomHistory.length > 20) {
        roomHistory.splice(0, Math.min(15, roomHistory.length - 20));
    }
}

function savePinnedRooms() {
    localStorage.setItem('pinnedRooms', JSON.stringify(pinnedRooms));
}

function updateRoomStatus(roomId, isOnline) {
    const wasOnline = pinnedStatuses[roomId];
    pinnedStatuses[roomId] = isOnline;

    if (wasOnline === false && isOnline === true) {
        playSFX('pinonline.wav');
    } else if (wasOnline === true && isOnline === false) {
        playSFX('pinoffline.wav');
    }
    updateNotifBar();
}

function togglePinRoom(roomId) {
    if (!roomId) return;
    const index = pinnedRooms.indexOf(roomId);
    if (index === -1) {
        pinnedRooms.push(roomId);
        savePinnedRooms();
        playSFX('pin.wav');
    } else {
        pinnedRooms.splice(index, 1);
        delete pinnedStatuses[roomId];
        savePinnedRooms();
        playSFX('unpin.wav');
    }
    updatePinDisplay();
    updateNotifBar();
    checkPinnedRoomsOnlineStatus();
}

function updatePinDisplay() {
    const pinTag = document.getElementById('isRoomPinned');
    const pinControls = document.querySelector('.room-controls');
    if (pinTag) {
        const isPinned = pinnedRooms.includes(currentRoom);
        pinTag.hidden = !isPinned;
    }
    if (pinControls) {
        const isPinned = pinnedRooms.includes(currentRoom);
        pinControls.innerHTML = `ESC: Return to menu<br>E:   Show react buttons<br>P:   ${isPinned ? 'Unpin' : 'Pin'} this room`;
    }
}

function updateNotifBar() {
    const notifEl = document.getElementById('notifRoomsOnline');
    if (!notifEl) return;

    if (pinnedRooms.length === 0) {
        notifEl.innerText = "No pinned rooms.";
        return;
    }

    const onlinePinned = pinnedRooms.filter(id => pinnedStatuses[id] === true);
    if (onlinePinned.length > 0) {
        notifEl.innerText = `Pinned online: ${onlinePinned.join(', ')}`;
    } else {
        notifEl.innerText = "No pinned rooms online.";
    }
}

async function checkPinnedRoomsOnlineStatus() {
    if (pinnedRooms.length === 0) {
        updateNotifBar();
        return;
    }

    if (!pinMonitorPeer || pinMonitorPeer.destroyed) {
        pinMonitorPeer = new Peer();
        await new Promise(resolve => pinMonitorPeer.on('open', resolve));
    }

    pinnedRooms.forEach(roomId => {
        if (currentRoom === roomId) {
            updateRoomStatus(roomId, true);
            return;
        }

        const testConn = pinMonitorPeer.connect(roomId);
        let statusResolved = false;

        const timeout = setTimeout(() => {
            if (!statusResolved) {
                statusResolved = true;
                testConn.close();
                updateRoomStatus(roomId, false);
            }
        }, 2000);

        testConn.on('open', () => {
            if (!statusResolved) {
                statusResolved = true;
                clearTimeout(timeout);
                testConn.close();
                updateRoomStatus(roomId, true);
            }
        });

        testConn.on('error', () => {
            if (!statusResolved) {
                statusResolved = true;
                clearTimeout(timeout);
                updateRoomStatus(roomId, false);
            }
        });
    });
}

setInterval(() => {
    const now = new Date();
    document.getElementById('time').innerText = now.toTimeString().split(' ')[0];
    document.getElementById('date').innerText = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    checkAndTrimMemory();
}, 1000);

setInterval(() => {
    checkPinnedRoomsOnlineStatus();
}, 5000);

let isEKeyPressed = false;

document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    const isTyping = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');

    if (e.key === 'Escape') {
        const activeSection = document.querySelector('section:not([hidden])');
        if (activeSection && activeSection.id !== 'logon' && activeSection.id !== 'menu') {
            leaveCurrentRoom();
            transitionTo('menu');
        }
    }

    if ((e.key === 'e' || e.key === 'E') && !e.repeat && !isEKeyPressed && !isTyping) {
        if (replyingToMsg) {
            clearReplyTarget();
        } else {
            isEKeyPressed = true;
            document.body.classList.add('show-reactions');
        }
    }

    if ((e.key === 'p' || e.key === 'P') && !isTyping) {
        const activeSection = document.querySelector('section:not([hidden])');
        if (activeSection && activeSection.id === 'room' && currentRoom) {
            togglePinRoom(currentRoom);
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'e' || e.key === 'E') {
        isEKeyPressed = false;
        document.body.classList.remove('show-reactions');
    }
});

window.addEventListener('blur', () => {
    isEKeyPressed = false;
    document.body.classList.remove('show-reactions');
});

function focusActiveInput() {
    const activeSection = document.querySelector('section:not([hidden])');
    if (activeSection && activeSection.id !== 'room') {
        const input = activeSection.querySelector('input:not([type="file"])');
        if (input && !input.disabled) {
            input.focus();
        }
    }
}

let activeTransitionTimer = null;

function transitionTo(targetSectionId) {
    if (activeTransitionTimer) {
        clearInterval(activeTransitionTimer);
        activeTransitionTimer = null;
    }

    const sections = document.querySelectorAll('section');
    sections.forEach(sec => {
        sec.hidden = true;
        const input = sec.querySelector('input');
        if (input) input.value = '';
    });

    const sameUserErr = document.getElementById('sameUserError');
    if (sameUserErr) sameUserErr.hidden = true;

    const miscJoinErr = document.getElementById('miscJoinError');
    if (miscJoinErr) miscJoinErr.hidden = true;

    setInputsDisabled(false);

    if (targetSectionId === 'room' && currentRoom) {
        document.title = `roomchat - ${currentRoom}`;
        updatePinDisplay();
    } else {
        document.title = 'roomchat';
    }

    const targetSection = document.getElementById(targetSectionId);
    targetSection.hidden = false;

    focusActiveInput();

    const elements = Array.from(targetSection.querySelectorAll('p:not(#sameUserError):not(#miscJoinError), span, input, button, .sidebar > p, #userList, .bottombar > span'));

    elements.forEach(el => el.classList.add('seq-hidden'));

    let index = 0;

    activeTransitionTimer = setInterval(() => {
        if (index < elements.length) {
            elements[index].classList.remove('seq-hidden');
            index++;
        } else {
            clearInterval(activeTransitionTimer);
            activeTransitionTimer = null;
            focusActiveInput();
        }
    }, 1000 / 60);
}

window.addEventListener('DOMContentLoaded', () => {
    transitionTo('logon');
    updateFavicon('1');
    updateNotifBar();
    checkPinnedRoomsOnlineStatus();
});

function setUsername(name) {
    currentUser = name;
    const userDisplay = document.getElementById('selfUsernameDisplay');
    if (userDisplay) userDisplay.innerText = currentUser;
}

document.getElementById('logonInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val.length >= 3) {
            setUsername(val);
            playSFX('success.wav');
            transitionTo('menu');
        } else {
            playSFX('error.wav');
        }
    }
});

document.getElementById('menuInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val === '1') transitionTo('roomSearch');
        if (val === '2') transitionTo('settings');
        if (val === '3') transitionTo('logon');
    }
});

document.getElementById('settingsInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        e.target.value = '';

        if (val === '') {
            transitionTo('menu');
        } else if (val === '1' || val === '2' || val === '3') {
            document.body.className = `theme-${val}`;
            updateFavicon(val);
            playSFX('success.wav');
        } else {
            playSFX('error.wav');
        }
    }
});

document.getElementById('roomSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const roomId = e.target.value.trim();
        if (roomId === '') {
            transitionTo('menu');
            return;
        }
        setInputsDisabled(true);
        initPeerSession(roomId);
    }
});

async function initPeerSession(roomId) {
    currentRoom = roomId;
    cryptoKey = await deriveCryptoKey(roomId);

    if (peer) {
        peer.destroy();
        peer = null;
    }

    peer = new Peer(roomId);

    peer.on('open', () => {
        isHost = true;
        setupHostRoom(roomId);
        if (pinnedRooms.includes(roomId)) {
            updateRoomStatus(roomId, true);
        }
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            isHost = false;
            peer.destroy();
            peer = null;
            setupClientRoom(roomId);
        } else {
            setInputsDisabled(false);
            playSFX('error.wav');
            const miscErr = document.getElementById('miscJoinError');
            if (miscErr) miscErr.hidden = false;
        }
    });
}

function storeHostMessage(msgData) {
    roomHistory.push(msgData);
    if (roomHistory.length > 69) {
        roomHistory.shift();
    }
}

function setupHostRoom(roomId) {
    document.getElementById('roomIDDisplay').innerText = roomId;
    document.getElementById('roomCreatorDisplay').innerText = currentUser;

    roomUsers = [{ name: currentUser, peerId: peer.id }];
    roomHistory = [];
    updateUserList(roomUsers.map(u => u.name));
    playSFX('success.wav');
    transitionTo('room');

    peer.on('connection', (conn) => {
        connections.push(conn);

        conn.on('data', async (rawPacket) => {
            let data;
            try {
                data = await decryptData(rawPacket);
            } catch (err) {
                console.error("Decryption failed:", err);
                return;
            }

            if (data.type === 'join') {
                const isDuplicate = roomUsers.some(u => u.name.toLowerCase() === data.user.toLowerCase());
                if (isDuplicate) {
                    sendEncrypted(conn, { type: 'error', message: 'Username is already taken in this room.' });
                    setTimeout(() => conn.close(), 200);
                    return;
                }

                roomUsers.push({ name: data.user, peerId: conn.peer });

                broadcast({ type: 'userList', users: roomUsers.map(u => u.name) });
                updateUserList(roomUsers.map(u => u.name));

                playSFX('joined.wav');

                const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
                const sysMsg = { type: 'system', text: `${data.user} has entered the room.`, msgId };

                appendMessage('[System]', sysMsg.text, msgId, true);
                storeHostMessage(sysMsg);

                sendEncrypted(conn, { type: 'history', messages: roomHistory.slice(-69) });
                broadcast(sysMsg, conn.peer);

            } else if (data.type === 'chat') {
                appendMessage(data.author, data.text, data.msgId, false, data.image, data.replyTo);
                storeHostMessage(data);
                if (document.hidden) playMessageSFX();
                broadcast(data, conn.peer);
            } else if (data.type === 'vote') {
                applyVote(data.msgId, data.voteType, data.user);

                const targetMsg = roomHistory.find(m => m.msgId === data.msgId);
                if (targetMsg) {
                    if (!targetMsg.votes) targetMsg.votes = {};
                    if (targetMsg.votes[data.user] === data.voteType) {
                        delete targetMsg.votes[data.user];
                    } else {
                        targetMsg.votes[data.user] = data.voteType;
                    }
                }

                broadcast(data, conn.peer);
            }
        });

        conn.on('close', () => {
            connections = connections.filter(c => c !== conn);
            const leavingUserObj = roomUsers.find(u => u.peerId === conn.peer);
            const leavingUser = leavingUserObj ? leavingUserObj.name : "A user";

            roomUsers = roomUsers.filter(u => u.peerId !== conn.peer);
            broadcast({ type: 'userList', users: roomUsers.map(u => u.name) });
            updateUserList(roomUsers.map(u => u.name));

            const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
            const sysMsg = { type: 'system', text: `${leavingUser} has left the room.`, msgId };
            appendMessage('[System]', sysMsg.text, msgId, true);
            storeHostMessage(sysMsg);
            broadcast(sysMsg);
        });
    });
}

function setupClientRoom(roomId) {
    peer = new Peer();

    peer.on('error', () => {
        setInputsDisabled(false);
        playSFX('error.wav');
        const miscErr = document.getElementById('miscJoinError');
        if (miscErr) miscErr.hidden = false;
        if (pinnedRooms.includes(roomId)) {
            updateRoomStatus(roomId, false);
        }
    });

    peer.on('open', () => {
        hostConn = peer.connect(roomId);

        hostConn.on('error', () => {
            setInputsDisabled(false);
            playSFX('error.wav');
            const miscErr = document.getElementById('miscJoinError');
            if (miscErr) miscErr.hidden = false;
            if (pinnedRooms.includes(roomId)) {
                updateRoomStatus(roomId, false);
            }
        });

        hostConn.on('open', () => {
            sendEncrypted(hostConn, { type: 'join', user: currentUser });
            document.getElementById('roomIDDisplay').innerText = roomId;
            document.getElementById('roomCreatorDisplay').innerText = 'Host';
            playSFX('success.wav');
            transitionTo('room');
            if (pinnedRooms.includes(roomId)) {
                updateRoomStatus(roomId, true);
            }
        });

        hostConn.on('data', async (rawPacket) => {
            let data;
            try {
                data = await decryptData(rawPacket);
            } catch (err) {
                console.error("Decryption failed:", err);
                return;
            }

            if (data.type === 'error') {
                playSFX('error.wav');
                leaveCurrentRoom();
                transitionTo('roomSearch');
                const errEl = document.getElementById('sameUserError');
                if (errEl) errEl.hidden = false;
            } else if (data.type === 'history') {
                const msgContainer = document.getElementById('msgContainer');
                const messages = msgContainer.querySelectorAll('.message:not(#templateMessageEntry)');
                messages.forEach(m => m.remove());

                data.messages.forEach(msg => {
                    const isSys = msg.type === 'system';
                    const author = isSys ? '[System]' : msg.author;

                    if (!document.querySelector(`[data-msg-id="${msg.msgId}"]`)) {
                        appendMessage(author, msg.text, msg.msgId, isSys, msg.image, msg.replyTo, true);
                    }

                    if (msg.votes) {
                        Object.entries(msg.votes).forEach(([vUser, vType]) => {
                            applyVote(msg.msgId, vType, vUser);
                        });
                    }
                });
            } else if (data.type === 'userList') {
                updateUserList(data.users);
            } else if (data.type === 'chat') {
                if (!document.querySelector(`[data-msg-id="${data.msgId}"]`)) {
                    appendMessage(data.author, data.text, data.msgId, false, data.image, data.replyTo);
                }
                if (document.hidden) playMessageSFX();
            } else if (data.type === 'system') {
                if (!document.querySelector(`[data-msg-id="${data.msgId}"]`)) {
                    appendMessage('[System]', data.text, data.msgId, true);
                }
                if (data.text.includes('has entered') && document.hidden) {
                    playSFX('joined.wav');
                }
            } else if (data.type === 'vote') {
                applyVote(data.msgId, data.voteType, data.user);
            }
        });

        hostConn.on('close', () => {
            if (pinnedRooms.includes(roomId)) {
                updateRoomStatus(roomId, false);
            }
            setInputsDisabled(false);
            playSFX('error.wav');
            leaveCurrentRoom();
            transitionTo('roomSearch');
            const miscErr = document.getElementById('miscJoinError');
            if (miscErr) {
                miscErr.innerText = 'The host has closed or left the room.';
                miscErr.hidden = false;
            }
        });
    });
}

function setReplyTarget(msgId, author, text) {
    if (replyingToMsg && replyingToMsg.msgId === msgId) {
        clearReplyTarget();
        return;
    }

    clearReplyTarget();

    replyingToMsg = { msgId, author, text };

    const targetMsgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
    if (targetMsgEl) {
        targetMsgEl.classList.add('reply-highlight');
    }

    const bar = document.getElementById('activeReplyBar');
    const targetText = document.getElementById('replyTargetText');
    if (bar && targetText) {
        targetText.innerText = `Replying to ${author}: "${text.length > 30 ? text.substring(0, 30) + '...' : text}"`;
        bar.hidden = false;
    }
    focusActiveInput();
}

function clearReplyTarget() {
    if (replyingToMsg) {
        const prevMsgEl = document.querySelector(`.message[data-msg-id="${replyingToMsg.msgId}"]`);
        if (prevMsgEl) {
            prevMsgEl.classList.remove('reply-highlight');
        }
    }
    replyingToMsg = null;
    const bar = document.getElementById('activeReplyBar');
    if (bar) bar.hidden = true;
}

function leaveCurrentRoom() {
    const activeRoomId = currentRoom;
    if (isHost && connections.length > 0) {
        connections.forEach(conn => conn.close());
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    connections = [];
    hostConn = null;
    currentRoom = "";
    isHost = false;
    cryptoKey = null;
    roomUsers = [];
    roomHistory = [];
    clearReplyTarget();
    document.body.classList.remove('show-reactions');

    if (activeRoomId && pinnedRooms.includes(activeRoomId)) {
        updateRoomStatus(activeRoomId, false);
    }

    const msgContainer = document.getElementById('msgContainer');
    const messages = msgContainer.querySelectorAll('.message:not(#templateMessageEntry)');
    messages.forEach(m => m.remove());
}

function broadcast(data, excludePeerId = null) {
    connections.forEach(conn => {
        if (conn.peer !== excludePeerId) {
            sendEncrypted(conn, data);
        }
    });
}

function updateUserList(users) {
    const container = document.getElementById('userList');
    container.innerHTML = '';
    document.getElementById('userCountInRoom').innerText = users.length;
    users.forEach(user => {
        const p = document.createElement('p');
        p.innerHTML = `- <span class="selectable">${user}</span>`;
        container.appendChild(p);
    });
}

document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim() !== '') {
        const text = e.target.value.trim();
        e.target.value = '';

        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
        const msgData = {
            type: 'chat',
            author: currentUser,
            text,
            msgId,
            replyTo: replyingToMsg ? { ...replyingToMsg } : null
        };

        appendMessage(currentUser, text, msgId, false, null, msgData.replyTo);
        clearReplyTarget();

        if (isHost) {
            storeHostMessage(msgData);
            broadcast(msgData);
        } else if (hostConn) {
            sendEncrypted(hostConn, msgData);
        } else {
            playSFX('error.wav');
        }
    }
});

document.getElementById('sendImageButton').addEventListener('click', () => {
    playSFX('press.wav');
    document.getElementById('imageInput').click();
});

document.getElementById('imageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 800;
            let width = img.width;
            let height = img.height;

            if (width > height && width > maxDim) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
            } else if (height > maxDim) {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const imageDataBase64 = canvas.toDataURL('image/jpeg', 0.7);

            const text = document.getElementById('chatInput').value.trim();
            document.getElementById('chatInput').value = '';

            const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
            const msgData = {
                type: 'chat',
                author: currentUser,
                text: text,
                image: imageDataBase64,
                msgId: msgId,
                replyTo: replyingToMsg ? { ...replyingToMsg } : null
            };

            appendMessage(currentUser, text, msgId, false, imageDataBase64, msgData.replyTo);
            clearReplyTarget();

            if (isHost) {
                storeHostMessage(msgData);
                broadcast(msgData);
            } else if (hostConn) {
                sendEncrypted(hostConn, msgData);
            } else {
                playSFX('error.wav');
            }
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
});

function typewriteMessageContent(element, htmlContent, skipAnimation = false) {
    if (skipAnimation) {
        element.innerHTML = htmlContent;
        return;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    const nodes = Array.from(tempDiv.childNodes);
    element.innerHTML = '';

    let nodeIndex = 0;

    function processNextNode() {
        if (nodeIndex >= nodes.length) return;

        const node = nodes[nodeIndex];
        nodeIndex++;

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            let charIndex = 0;
            const textNode = document.createTextNode('');
            element.appendChild(textNode);

            const charInterval = setInterval(() => {
                if (charIndex < text.length) {
                    textNode.textContent += text[charIndex];
                    charIndex++;
                    const msgContainer = document.getElementById('msgContainer');
                    if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
                } else {
                    clearInterval(charInterval);
                    setTimeout(processNextNode, 1000 / 60);
                }
            }, 1000 / 120);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const wrapper = node.cloneNode(false);
            element.appendChild(wrapper);

            typewriteMessageContent(wrapper, node.innerHTML, false);

            setTimeout(processNextNode, 1000 / 60);
        } else {
            element.appendChild(node.cloneNode(true));
            setTimeout(processNextNode, 1000 / 60);
        }
    }

    processNextNode();
}

function appendMessage(author, text, msgId, isSystem = false, imageData = null, replyData = null, skipAnimation = false) {
    const container = document.getElementById('msgContainer');
    const template = document.getElementById('templateMessageEntry');
    const msg = template.cloneNode(true);

    msg.removeAttribute('id');
    msg.dataset.msgId = msgId;
    msg.dataset.votes = JSON.stringify({});
    msg.hidden = false;

    const replyingElements = msg.querySelectorAll('[data-replying]');
    const replyUserEl = msg.querySelector('#replyingToUser');
    const replyContentEl = msg.querySelector('#replyingToContent');

    if (replyData) {
        replyingElements.forEach(el => el.hidden = false);
        if (replyUserEl) replyUserEl.innerText = `${replyData.author}: `;
        if (replyContentEl) replyContentEl.innerHTML = formatChatMessage(replyData.text) || '[Image]';
    } else {
        replyingElements.forEach(el => el.hidden = true);
    }

    msg.querySelector('#messageAuthor').innerText = `${author}: `;

    const contentSpan = msg.querySelector('#messageContent');
    if (text) {
        const formattedHtml = formatChatMessage(text);
        typewriteMessageContent(contentSpan, formattedHtml, skipAnimation);
    } else {
        contentSpan.hidden = true;
    }

    const msgImg = msg.querySelector('#messageImage');
    const imgBreaks = msg.querySelectorAll('#imageBreak');
    const downloadBtn = msg.querySelector('#downloadBtn');

    if (imageData && msgImg) {
        msgImg.src = imageData;
        msgImg.hidden = false;
        imgBreaks.forEach(br => br.hidden = false);

        if (downloadBtn) {
            downloadBtn.hidden = false;
            downloadBtn.onclick = () => {
                const now = new Date();
                const dateStr = now.toISOString().split('T')[0];
                const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
                const filename = `${currentRoom || 'room'}-${dateStr}-${timeStr}.png`;

                const a = document.createElement('a');
                a.href = imageData;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            };
        }
    }

    const upBtn = msg.querySelector('#upvoteBtn');
    const downBtn = msg.querySelector('#downvoteBtn');
    const waveBtn = msg.querySelector('#waveBtn');
    const replyBtn = msg.querySelector('#replyBtn');

    if (isSystem) {
        if (upBtn) upBtn.hidden = true;
        if (downBtn) downBtn.hidden = true;
        if (replyBtn) replyBtn.hidden = true;
        if (waveBtn) {
            waveBtn.hidden = false;
            waveBtn.onclick = () => {
                playSFX('press.wav');
                handleVoteClick(msgId, 'wave');
            };
        }
    } else {
        if (upBtn) {
            upBtn.onclick = () => {
                playSFX('press.wav');
                handleVoteClick(msgId, 'up');
            };
        }
        if (downBtn) {
            downBtn.onclick = () => {
                playSFX('press.wav');
                handleVoteClick(msgId, 'down');
            };
        }
        if (replyBtn) {
            replyBtn.hidden = false;
            replyBtn.onclick = () => {
                playSFX('press.wav');
                setReplyTarget(msgId, author, text || '[Image]');
            };
        }
    }

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function handleVoteClick(msgId, voteType) {
    applyVote(msgId, voteType, currentUser);

    const voteData = { type: 'vote', msgId, voteType, user: currentUser };
    if (isHost) {
        const targetMsg = roomHistory.find(m => m.msgId === msgId);
        if (targetMsg) {
            if (!targetMsg.votes) targetMsg.votes = {};
            if (targetMsg.votes[currentUser] === voteType) {
                delete targetMsg.votes[currentUser];
            } else {
                targetMsg.votes[currentUser] = voteType;
            }
        }
        broadcast(voteData);
    } else if (hostConn) {
        sendEncrypted(hostConn, voteData);
    }
}

function applyVote(msgId, voteType, user) {
    const msg = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msg) return;

    let votesMap = JSON.parse(msg.dataset.votes || '{}');

    if (votesMap[user] === voteType) {
        delete votesMap[user];
    } else {
        votesMap[user] = voteType;
    }

    msg.dataset.votes = JSON.stringify(votesMap);

    let upCount = 0;
    let downCount = 0;
    let waveCount = 0;

    Object.values(votesMap).forEach(type => {
        if (type === 'up') upCount++;
        if (type === 'down') downCount++;
        if (type === 'wave') waveCount++;
    });

    const reactionsSpan = msg.querySelector('#messageReactions');
    let parts = [];
    if (upCount > 0) parts.push(`👍${upCount}`);
    if (downCount > 0) parts.push(`👎${downCount}`);
    if (waveCount > 0) parts.push(`👋${waveCount}`);

    reactionsSpan.innerText = parts.join('|');
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#sendImageButton') || e.target.closest('.reactionBtn')) return;
    focusActiveInput();
});

window.addEventListener('focus', () => {
    focusActiveInput();
});