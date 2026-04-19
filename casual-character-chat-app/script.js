document.addEventListener('DOMContentLoaded', () => {
document.body.style.opacity = '1';

let db;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('CasualCharacterChatDB', 3);

        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains('characters')) {
                dbInstance.createObjectStore('characters', { keyPath: 'id' });
            }
            if (!dbInstance.objectStoreNames.contains('personas')) {
                dbInstance.createObjectStore('personas', { keyPath: 'id' });
            }
            if (!dbInstance.objectStoreNames.contains('settings')) {
                dbInstance.createObjectStore('settings', { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("IndexedDB error:", event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}



const availableModels = [
  { id: "z-ai/glm-4.5-air:free", name: "Z.AI: GLM 4.5 Air (free)" }
];



const APP_VERSION = 1.0;



const DEFAULT_API_URL = "https://openrouter.ai/api/v1/chat/completions";



const defaultSettings = {
        fontSize: '18',
        temperature: '0.70',
        model: availableModels[0].id,
        mainTextColor: '#FFFFFF',
        dialogueColor: '#ffd952',
        userBubbleColor: '#141414',
        userBubbleOpacity: '0.7',
        aiBubbleColor: '#141414',
        aiBubbleOpacity: '0.7',
        messageSpacing: '50', 
        soundEnabled: 'true',
        thinkEnabled: 'true',
        blur: '5',
        avatarSize: '200',
    };

    let audioCtx;
    let soundEnabled = true;
    let thinkEnabled = true;
    let characters = {};
    let currentCharacterId = null;
    let tempUploadedImages = {
  avatar: null,
  avatarOriginal: null, 
  background: null,
  backgroundOriginal: null, 
  personaAvatar: null,
  personaAvatarOriginal: null 
};
    let currentChatId = null;
    let activeGroupParticipantId = null;
    let personas = {};
    let appSettings = {};
    let currentStreamController = null; 
    const stopStreamBtn = document.getElementById('stop-stream-btn');

    

    // --- GET ELEMENTS ---
    const characterSelectionScreen = document.getElementById('character-selection-screen');
    const chatListScreen = document.getElementById('chat-list-screen');
    const chatScreen = document.getElementById('chat-screen');
    const newCharacterBtn = document.getElementById('new-character-btn');
    const searchInput = document.getElementById('search-input');
    const characterList = document.getElementById('character-list');
    const archiveSection = document.getElementById('archive-section');
    const archiveToggleBtn = document.getElementById('archive-toggle-btn');
    const archiveContent = document.getElementById('archive-content');
    const archivedCharacterList = document.getElementById('archived-character-list');
    const starsContainer = document.getElementById('stars-container');
    // Persona Management Elements
    const managePersonasBtn = document.getElementById('manage-personas-btn');
    const personaListModal = document.getElementById('persona-list-modal');
    const closePersonaListBtn = document.getElementById('close-persona-list-btn');
    const createNewPersonaBtn = document.getElementById('create-new-persona-btn');
    const personaEditorModal = document.getElementById('persona-editor-modal');
    const cancelPersonaEditBtn = document.getElementById('cancel-persona-edit-btn');
    const personaForm = document.getElementById('persona-form');
    const personaAvatarInput = document.getElementById('persona-avatar');
    const personaEditorAvatarImg = document.getElementById('persona-editor-avatar-img');
    const personaEditorAvatarPlaceholder = document.getElementById('persona-editor-avatar-placeholder');
    const personaListSearchInput = document.getElementById('persona-list-search-input');
    const personaEditorTokenCounter = document.getElementById('persona-editor-token-counter');
    // Persona Selection Elements
    const selectPersonaBtn = document.getElementById('select-persona-btn');
    const personaSelectionModal = document.getElementById('persona-selection-modal');
    const personaSelectionList = document.getElementById('persona-selection-list');
    const cancelPersonaSelectBtn = document.getElementById('cancel-persona-select-btn');
    // Other Elements
    const backToMainBtn = document.getElementById('back-to-main-btn');
    const backToSelectionBtn = document.getElementById('back-to-selection-btn');
    const chatSessionListDiv = document.getElementById('chat-session-list');
    const startNewChatBtn = document.getElementById('start-new-chat-btn');
    const editCharacterBtn = document.getElementById('edit-character-btn');
    const copyCharacterBtn = document.getElementById('copy-character-btn');
    const characterEditorModal = document.getElementById('character-editor-modal');
    const characterForm = document.getElementById('character-form');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const editingCharField = document.getElementById('editing-char-id');
    const characterEditorModalContent = document.getElementById('character-editor-modal-content');
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const groupCharDropdown      = document.getElementById('group-char-dropdown');
    const groupCharBubble        = document.getElementById('group-char-bubble');
    const groupCharBubbleName    = document.getElementById('group-char-bubble-name');
    const groupCharBubbleDismiss = document.getElementById('group-char-bubble-dismiss');
    const messageInput = document.getElementById('message-input');
    const chatAvatar = document.getElementById('chat-avatar');
    const chatCharacterName = document.getElementById('chat-character-name');
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const fileInput = document.getElementById('file-importer');
    const loadingIndicator = document.getElementById('loading-indicator');
    const messageEditorModal = document.getElementById('message-editor-modal');
    const dialogBtn = document.getElementById('dialog-btn');
    const storyBtn = document.getElementById('story-btn');
    const messageEditorTextarea = document.getElementById('message-editor-textarea');
    const saveMessageEditBtn = document.getElementById('save-message-edit-btn');
    const cancelMessageEditBtn = document.getElementById('cancel-message-edit-btn');
    const chatMemoriesBtn = document.getElementById('chat-memories-btn');
    const chatMemoriesModal = document.getElementById('chat-memories-modal');
    const chatMemoriesTextarea = document.getElementById('chat-memories-textarea');
    const saveMemoriesEditBtn = document.getElementById('save-memories-edit-btn');
    const cancelMemoriesEditBtn = document.getElementById('cancel-memories-edit-btn');
    if (dialogBtn) {
        dialogBtn.setAttribute('aria-label', 'Send as Character');
    }
    if (storyBtn) {
        storyBtn.setAttribute('aria-label', 'Send as Narrator');
    }
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const settingsContainer = document.getElementById('settings-container');
    const fontSizeSlider = document.getElementById('font-size-slider');
    const fontSizeValue = document.getElementById('font-size-value');
    const temperatureSlider = document.getElementById('temperature-slider');
    const temperatureValue = document.getElementById('temperature-value');
    const mainTextColorPicker = document.getElementById('main-text-color-picker');
    const dialogueColorPicker = document.getElementById('dialogue-color-picker');
    const userBubbleColorPicker = document.getElementById('user-bubble-color-picker');
    const userBubbleOpacitySlider = document.getElementById('user-bubble-opacity-slider');
    const userBubbleOpacityValue = document.getElementById('user-bubble-opacity-value');
    const aiBubbleColorPicker = document.getElementById('ai-bubble-color-picker');
    const aiBubbleOpacitySlider = document.getElementById('ai-bubble-opacity-slider');
    const aiBubbleOpacityValue = document.getElementById('ai-bubble-opacity-value');
    const resetSettingsBtn = document.getElementById('reset-settings-btn');
    const spacingSlider = document.getElementById('spacing-slider');
    const spacingValue = document.getElementById('spacing-value');
    const soundToggle = document.getElementById('sound-toggle');
    const thinkToggle = document.getElementById('think-toggle');
    const scrollTopFab = document.getElementById('scroll-top-fab');
    const deleteCharacterBtnDashboard = document.getElementById('delete-character-btn-dashboard');
    const blurSlider = document.getElementById('blur-slider');
    const blurValue = document.getElementById('blur-value');
    const avatarSizeSlider = document.getElementById('avatar-size-slider');
    const avatarSizeValue = document.getElementById('avatar-size-value');
    const modelSelect = document.getElementById('model-select');
    const MOBILE_BREAKPOINT_PX = 768;
    const MOBILE_FONT_SIZE_MAX = 24;
    const MOBILE_AVATAR_SIZE_MAX = 180;
    const DESKTOP_FONT_SIZE_MAX = fontSizeSlider ? Number(fontSizeSlider.max) || MOBILE_FONT_SIZE_MAX : MOBILE_FONT_SIZE_MAX;
    const DESKTOP_AVATAR_SIZE_MAX = avatarSizeSlider ? Number(avatarSizeSlider.max) || MOBILE_AVATAR_SIZE_MAX : MOBILE_AVATAR_SIZE_MAX;
    const responsiveViewportQuery = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`)
        : null;
    const chatAvatarPlaceholder = document.getElementById('chat-avatar-placeholder');
    const chatListAvatarPlaceholder = document.getElementById('chat-list-avatar-placeholder');
    chatListScreen.classList.add('is-inactive');
    chatScreen.classList.add('is-inactive');
    characterSelectionScreen.style.pointerEvents = 'auto';
    chatListScreen.style.pointerEvents = 'none';
    chatScreen.style.pointerEvents = 'none';
    starsContainer.style.pointerEvents = 'none';

    const tokenTooltip = document.getElementById('token-tooltip');
    const editorTokenCounter = document.getElementById('editor-token-counter');
    // Elements for the scenario selection modal
    const scenarioSelectionModal = document.getElementById('scenario-selection-modal');
    const scenarioSelectionList = document.getElementById('scenario-selection-list');
    const startEmptyChatBtn = document.getElementById('start-empty-chat-btn');
    const cancelScenarioSelectionBtn = document.getElementById('cancel-scenario-selection-btn');
    // Get upper editor buttons
    const saveEditBtnTop = document.getElementById('save-edit-btn-top');
    const cancelEditBtnTop = document.getElementById('cancel-edit-btn-top');
    // Get new elements for the editor
    const editorAvatarImg = document.getElementById('editor-avatar-img');
    const editorAvatarPlaceholder = document.getElementById('editor-avatar-placeholder');
    const charInstructionsInput = document.getElementById('char-instructions');
    const charDescriptionInput = document.getElementById('char-description');
    const charLoreInput = document.getElementById('char-lore');
    // Group Chat and search elements
    const addParticipantBtn = document.getElementById('add-participant-btn');
    const participantIconList = document.getElementById('participant-icon-list');
    const participantSelectionModal = document.getElementById('participant-selection-modal');
    const participantSelectionList = document.getElementById('participant-selection-list');
    const cancelParticipantSelectionBtn = document.getElementById('cancel-participant-selection-btn');
    const participantSearchInput = document.getElementById('participant-search-input');
    const personaSearchInput = document.getElementById('persona-search-input');
    // App Settings Modal Elements
    const appSettingsModal = document.getElementById('app-settings-modal');
    const appSettingsBtn = document.getElementById('app-settings-btn');
    const appSettingsForm = document.getElementById('app-settings-form');
    const modelListContainer = document.getElementById('model-list-container');
    const addModelBtn = document.getElementById('add-model-btn');
    const resetAppSettingsBtn = document.getElementById('reset-app-settings-btn');
    const cancelAppSettingsBtn = document.getElementById('cancel-app-settings-btn');
    const appSettingsModalContent = document.getElementById('app-settings-modal-content');





    // --- FUNCTIONS ---

let __freezeScrollY = 0;

function freezeLayout() {
  const docEl = document.documentElement;
  const sbw = window.innerWidth - docEl.clientWidth; 
  __freezeScrollY = window.scrollY || docEl.scrollTop || 0;

  docEl.classList.add('freeze-layout');
  document.body.classList.add('freeze-body');

  document.body.style.top = `-${__freezeScrollY}px`;
  if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
}

function unfreezeLayout() {
  document.documentElement.classList.remove('freeze-layout');
  document.body.classList.remove('freeze-body');
  document.body.style.paddingRight = '';
  document.body.style.top = '';
  window.scrollTo(0, __freezeScrollY);
}



function showCustomAlert(message) {
    const alertOverlay = document.createElement('div');
    alertOverlay.className = 'custom-alert-overlay';

    const alertModal = document.createElement('div');
    alertModal.className = 'custom-alert-modal';

    const messageP = document.createElement('p');
    messageP.textContent = message;

    const okButton = document.createElement('button');
    okButton.textContent = 'OK';
    okButton.className = 'action-btn'; 

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'custom-dialog-buttons';
    buttonContainer.style.justifyContent = 'flex-end'; 
    buttonContainer.appendChild(okButton);

    alertModal.appendChild(messageP);
    alertModal.appendChild(buttonContainer); 
    alertOverlay.appendChild(alertModal);

    document.body.appendChild(alertOverlay);
    
    okButton.focus();

    okButton.addEventListener('click', () => {
        alertOverlay.remove();
    });
}



function showCustomPrompt(message, defaultValue = '') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'custom-alert-overlay';

        const modal = document.createElement('div');
        modal.className = 'custom-alert-modal';

        const messageP = document.createElement('p');
        messageP.textContent = message;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue;
        input.className = 'custom-prompt-input';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'custom-dialog-buttons';

        const okButton = document.createElement('button');
        okButton.textContent = 'OK';
        okButton.className = 'action-btn';

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.className = 'secondary-btn';

        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(okButton);
        modal.appendChild(messageP);
        modal.appendChild(input);
        modal.appendChild(buttonContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        input.focus();
        input.select();

        const confirm = () => {
            overlay.remove();
            resolve(input.value);
        };
        const cancel = () => {
            overlay.remove();
            resolve(null);
        };

        okButton.addEventListener('click', confirm);
        cancelButton.addEventListener('click', cancel);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') cancel();
        });
    });
}



function showCustomConfirm(message, danger = false) {
    return new Promise(resolve => {
        const confirmOverlay = document.createElement('div');
        confirmOverlay.className = 'custom-alert-overlay';

        const confirmModal = document.createElement('div');
        confirmModal.className = 'custom-alert-modal';

        const messageP = document.createElement('p');
        messageP.textContent = message;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'custom-dialog-buttons';

        const okButton = document.createElement('button');
        okButton.textContent = 'OK';
        okButton.className = danger ? 'action-btn danger-btn' : 'action-btn';

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.className = 'secondary-btn';

        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(okButton);
        confirmModal.appendChild(messageP);
        confirmModal.appendChild(buttonContainer);
        confirmOverlay.appendChild(confirmModal);
        document.body.appendChild(confirmOverlay);
        
        okButton.focus();

        okButton.addEventListener('click', () => {
            confirmOverlay.remove();
            resolve(true); 
        });

        cancelButton.addEventListener('click', () => {
            confirmOverlay.remove();
            resolve(false); 
        });
    });
}



function showChoiceDialog(message, options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-alert-overlay';
    const modal = document.createElement('div');
    modal.className = 'custom-alert-modal';

    const p = document.createElement('p');
    p.textContent = message;

    const btns = document.createElement('div');
    btns.className = 'custom-dialog-buttons';

    options.forEach(opt => {
      const b = document.createElement('button');
      b.textContent = opt.label;
      b.className = (opt.primary ? 'action-btn' : 'secondary-btn') + (opt.extraClass ? ' ' + opt.extraClass : '');
      b.addEventListener('click', () => { overlay.remove(); resolve(opt.value); });
      btns.appendChild(b);
    });

    modal.appendChild(p);
    modal.appendChild(btns);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}



function extractDataFromPng(arrayBuffer) {
    const dataView = new DataView(arrayBuffer);
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < pngSignature.length; i++) {
        if (dataView.getUint8(i) !== pngSignature[i]) {
            console.error("Not a valid PNG file.");
            return null;
        }
    }

    let offset = 8;
    while (offset < dataView.byteLength) {
        const length = dataView.getUint32(offset);
        const type = String.fromCharCode(
            dataView.getUint8(offset + 4), 
            dataView.getUint8(offset + 5), 
            dataView.getUint8(offset + 6), 
            dataView.getUint8(offset + 7)
        );

        if (type === 'tEXt') {
            const textDecoder = new TextDecoder('utf-8');
            const chunkData = textDecoder.decode(new Uint8Array(arrayBuffer, offset + 8, length));
            
            if (chunkData.startsWith('chara\0')) {
                const payload = chunkData.substring(6);
try {
  return JSON.parse(payload);
} catch (_) {
  try {
    const binaryString = atob(payload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const jsonString = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("Failed to decode or parse character data from PNG:", e);
    return null;
  }
}
            }
        }
        offset += 12 + length;
    }
    return null;
}



function sanitizeCardNotes(raw) {
  const str = String(raw || "");
  const imageUrlRegex = /https?:\/\/[^\s"'()<>]+?\.(?:png|jpe?g|gif|webp|svg)/gi;
  const imageUrls = Array.from(str.matchAll(imageUrlRegex)).map(m => m[0]);

  let cleaned = str
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]\s*>/gi, "\n")
    .replace(/<h[1-6][^>]*>/gi, "");

  cleaned = cleaned.replace(/<\/?[^>]+>/g, "");

  const ta = document.createElement("textarea");
  ta.innerHTML = cleaned;
  cleaned = ta.value;
  cleaned = cleaned.replace(/\r\n?/g, "\n"); 
  cleaned = cleaned
    .split("\n")
    .map(line => line.replace(/[ \t\f\v]+/g, " ").trimEnd()) 
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")   
    .trim();

  if (imageUrls.length) {
    const list = Array.from(new Set(imageUrls)).join("\n");
    cleaned = `${cleaned}${cleaned ? "\n\n" : ""}Image links:\n${list}`;
  }
  return cleaned;
}




function convertExternalCardToCCC(externalCard, imageBlob = null) {
  const data = externalCard.data || externalCard; 
  console.log('[IMPORT MAP]', {
    has_card_description: !!data.card_description,
    has_tagline: !!data.tagline,
    has_lore: !!data.lore,
    has_lorebook: !!data.lorebook,
    has_character_book: !!data.character_book,
    has_creator_notes: !!(data.creator_notes || data.card_notes || data.creator_note || data.notes)
  });
    const cardDescription = data.card_description || data.tagline || "";
    const allDescriptions = [
        cardDescription,
        "\n--- CHARACTER DESCRIPTION ---",
        data.personality || "",
        data.description || "",
        "\n--- EXAMPLE MESSAGES ---",
        data.mes_example || ""
    ].filter(s => s.trim() !== "").join("\n\n").trim();

    const cardNotes =
  data.card_notes ||
  data.creator_notes ||
  data.creator_note || 
  data.notes ||  
  "";
  const cleanCardNotes = sanitizeCardNotes(cardNotes);
const cardDescOrTagline = (data.card_description || data.tagline || "").trim();

const lorePieces = [];

if (typeof data.character_book === "string" && data.character_book.trim()) {
  lorePieces.push(data.character_book.trim());
}

if (data.character_book && Array.isArray(data.character_book.entries)) {
  data.character_book.entries.forEach((e) => {
    const keys = Array.isArray(e.keys) ? e.keys.join(", ") : (e.key || "");
    const val  = e.content || e.value || "";
    const entryText = [keys ? `[${keys}]` : "", val].filter(Boolean).join("\n").trim();
    if (entryText) lorePieces.push(entryText);
  });
}

if (typeof data.lorebook === "string" && data.lorebook.trim()) {
  lorePieces.push(data.lorebook.trim());
}
if (typeof data.lore === "string" && data.lore.trim()) {
  lorePieces.push(data.lore.trim());
}
if (typeof data.world_scenario === "string" && data.world_scenario.trim()) {
  lorePieces.push(data.world_scenario.trim());
}

const filteredLorePieces = lorePieces.filter(p => p.trim() && p.trim() !== cardDescOrTagline);

const allLore = [
  ...filteredLorePieces,
  cleanCardNotes ? `\n\n--- CARD NOTES ---\n${cleanCardNotes}` : ""
].filter(s => s.trim() !== "").join("\n\n").trim();


    const allScenarios = [];
    const mainScenarioText = [data.scenario || "", data.first_mes || ""].join("\n\n").trim();
    if (mainScenarioText) {
        allScenarios.push({ name: 'Main Greeting', text: mainScenarioText });
    }
    if (Array.isArray(data.alternate_greetings)) {
        data.alternate_greetings.forEach((greeting, index) => {
            if (typeof greeting === 'string' && greeting.trim() !== '') {
                allScenarios.push({
                    name: `Alternate Greeting ${index + 1}`,
                    text: greeting.trim()
                });
            }
        });
    }

    const newChar = {
        id: 'char-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        name: data.name || 'Unnamed Import',
        avatar: imageBlob || data.avatar || "",
        background: '',
        description: allDescriptions,
        lore: allLore,
        tags: (Array.isArray(data.tags) ? data.tags.join(', ') : ''),
        instructions: data.system_prompt || '',
        reminder: data.post_history_instructions || '',
        narratorReminder: '',
        scenarios: allScenarios,
        chats: {}
    };
    return newChar;
}



  function adjustFontSizeToFit(element) {
    const MIN_FONT_SIZE = 8;
    const inner = element.querySelector('span') || element;

    element.style.fontSize = '';

    // Element has no layout (inside a hidden/collapsed parent) — skip
    if (element.clientHeight <= 0) return;

    const style = window.getComputedStyle(element);
    const paddingV = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const maxHeight = element.clientHeight - paddingV;

    let size = parseFloat(style.fontSize);
    while (size > MIN_FONT_SIZE) {
      if (inner.scrollHeight <= maxHeight) break;
      size -= 1;
      element.style.fontSize = size + 'px';
    }
  }



    function getImageUrl(source) {
  if (source instanceof Blob) {
    return URL.createObjectURL(source);
  }
  return source || ''; 
}



function smartObjectFit(img) {
  if (!img) return;
  const apply = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    img.style.objectFit = (w > h) ? 'cover' : 'contain';
    img.style.objectPosition = 'center';
  };
  if (img.complete) apply();
  else img.addEventListener('load', apply, { once: true });
}

function smartObjectFitAll(selector) {
  document.querySelectorAll(selector).forEach(smartObjectFit);
}



function applyCharPlaceholder(s, charName) {
  return (s || '').replace(/{{\s*char\s*}}/g, charName);
}



function applyUserPlaceholder(s, persona) {
    if (persona && persona.name) {
        return (s || '').replace(/{{\s*user\s*}}/g, persona.name);
    }
    return s || '';
}



function closeAppSettingsModal() {
    const textareas = appSettingsModal.querySelectorAll('.global-prompts-content textarea');
    textareas.forEach(textarea => {
        textarea.style.height = 'auto';
        textarea.style.overflowY = 'hidden';
    });
    appSettingsModalContent.scrollTop = 0;
    appSettingsModal.classList.add('hidden');
}



async function saveAppSettings() {
    const models = [];
    document.querySelectorAll('.model-entry').forEach(entry => {
        const name = entry.querySelector('.model-name-input').value.trim();
        const id = entry.querySelector('.model-id-input').value.trim();
        const targetApiUrl = entry.querySelector('.model-target-api-url-input').value.trim(); 
        const apiKey = entry.querySelector('.model-api-key-input').value.trim();
        const instructions = entry.querySelector('.model-instructions-input').value.trim();
        const reminder = entry.querySelector('.model-reminder-input').value.trim();
        const narratorReminder = entry.querySelector('.model-narrator-reminder-input').value.trim();

        if (name && id) {
            models.push({ name, id, targetApiUrl, apiKey, instructions, reminder, narratorReminder }); 
        }
    });

    const newSettings = {
        apiKey: document.getElementById('api-key-input').value.trim(),
        availableModels: models
    };

    if (db) {
        const transaction = db.transaction(['settings'], 'readwrite');
        const store = transaction.objectStore('settings');
        store.put({ key: 'appSettings', value: newSettings });
    }

    appSettings = newSettings;
    populateModelSelector();
    appSettingsModalContent.scrollTop = 0;
    appSettingsModal.classList.add('hidden');
}



async function loadAppSettingsFromDB() {
    const defaultSettings = {
        availableModels: availableModels
    };

    if (db) {
        const transaction = db.transaction(['settings'], 'readonly');
        const store = transaction.objectStore('settings');
        const settingsRecord = await new Promise((resolve, reject) => {
            const request = store.get('appSettings');
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });

        appSettings = settingsRecord ? settingsRecord.value : defaultSettings;
    } else {
        appSettings = defaultSettings;
    }

    document.getElementById('api-key-input').value = appSettings.apiKey || '';
    modelListContainer.innerHTML = '';
    if (appSettings.availableModels) {
        appSettings.availableModels.forEach(model => createModelEntry(model));
    }
}



async function resetAppSettings() {
  if (await showCustomConfirm('Are you sure you want to reset all settings to their default values?', true)) {
    modelListContainer.innerHTML = '';
    availableModels.forEach(m => createModelEntry({
      name: m.name,
      id: m.id,
      instructions: '',
      reminder: '',
      narratorReminder: ''
    }));
    await saveAppSettings();
  }
}



    function playNotificationSound() {
        if (!soundEnabled) return;
        if (!audioCtx) return;
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(659.26, audioCtx.currentTime); 

        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.5);
    }
    


    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ?
            { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
    }



    function applySetting(key, value) {
        const root = document.documentElement;
        switch (key) {
            case 'fontSize':
                fontSizeValue.textContent = `${value}px`;
                root.style.setProperty('--chat-font-size', `${value}px`);
                break;
            case 'temperature':
                temperatureValue.textContent = parseFloat(value).toFixed(2);
                break;
            case 'mainTextColor':
                root.style.setProperty('--main-text-color', value);
                break;
            case 'dialogueColor':
                root.style.setProperty('--dialogue-color', value);
                break;
            case 'userBubbleColor':
            case 'userBubbleOpacity':
                const userColor = hexToRgb(userBubbleColorPicker.value);
                const userOpacity = userBubbleOpacitySlider.value;
                if (userColor) {
                    root.style.setProperty('--user-bubble-color', `rgba(${userColor.r}, ${userColor.g}, ${userColor.b}, ${userOpacity})`);
                }
                userBubbleOpacityValue.textContent = `${Math.round(userOpacity * 100)}%`;
                break;
            case 'aiBubbleColor':
            case 'aiBubbleOpacity':
                const aiColor = hexToRgb(aiBubbleColorPicker.value);
                const aiOpacity = aiBubbleOpacitySlider.value;
                if (aiColor) {
                    root.style.setProperty('--ai-bubble-color', `rgba(${aiColor.r}, ${aiColor.g}, ${aiColor.b}, ${aiOpacity})`);
                }
                aiBubbleOpacityValue.textContent = `${Math.round(aiOpacity * 100)}%`;
                break;
            case 'messageSpacing':
                spacingValue.textContent = `${value}px`;
                root.style.setProperty('--message-spacing', `${value}px`);
                break;
            case 'soundEnabled':
                soundEnabled = (value === 'true' || value === true);
                break;
            case 'thinkEnabled':
                thinkEnabled = (value === 'true' || value === true);
                break;
            case 'blur':
                blurValue.textContent = `${value}px`;
                root.style.setProperty('--message-blur', `${value}px`);
                break;
                case 'avatarSize':
                
                avatarSizeValue.textContent = `${value}px`;
             
                root.style.setProperty('--ai-avatar-size', `${value}px`);
          
                const placeholderIconSize = Math.round(value * 0.6);
        
                root.style.setProperty('--ai-placeholder-icon-size', `${placeholderIconSize}px`);
                break;
        }
    }



    async function saveSettingToDB(key, value) {
    if (!db) return;
    const transaction = db.transaction(['settings'], 'readwrite');
    const store = transaction.objectStore('settings');
    store.put({ key: key, value: value });

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}
    


    async function loadAndApplySettingsFromDB() {
    if (!db) return;

    const transaction = db.transaction(['settings'], 'readonly');
    const store = transaction.objectStore('settings');
    const allSettingsRecords = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });

    const savedSettings = allSettingsRecords.reduce((map, setting) => {
        map[setting.key] = setting.value;
        return map;
    }, {});

    const settingsMap = {
        fontSize: fontSizeSlider,
        temperature: temperatureSlider,
        mainTextColor: mainTextColorPicker,
        dialogueColor: dialogueColorPicker,
        userBubbleColor: userBubbleColorPicker,
        userBubbleOpacity: userBubbleOpacitySlider,
        aiBubbleColor: aiBubbleColorPicker,
        aiBubbleOpacity: aiBubbleOpacitySlider,
        messageSpacing: spacingSlider,
        soundEnabled: soundToggle,
        thinkEnabled: thinkToggle,
        blur: blurSlider,
        avatarSize: avatarSizeSlider,
        model: modelSelect,
    };

    for (const key in defaultSettings) {
        const value = savedSettings[key] || defaultSettings[key];
        const inputElement = settingsMap[key];

        if (inputElement) {
            if (inputElement.type === 'checkbox') {
                inputElement.checked = (value === 'true' || value === true);
            } else {
                inputElement.value = value;
            }
        }
        applySetting(key, value);
    }
}


function enforceResponsiveSettingLimits() {
    if (!fontSizeSlider || !avatarSizeSlider) return;

    const isMobileViewport = responsiveViewportQuery
        ? responsiveViewportQuery.matches
        : (typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT_PX : false);
    const targetFontMax = isMobileViewport ? MOBILE_FONT_SIZE_MAX : DESKTOP_FONT_SIZE_MAX;
    const targetAvatarMax = isMobileViewport ? MOBILE_AVATAR_SIZE_MAX : DESKTOP_AVATAR_SIZE_MAX;

    if (Number(fontSizeSlider.max) !== targetFontMax) {
        fontSizeSlider.max = String(targetFontMax);
    }

    if (Number(avatarSizeSlider.max) !== targetAvatarMax) {
        avatarSizeSlider.max = String(targetAvatarMax);
    }

    if (Number(fontSizeSlider.value) > targetFontMax) {
        fontSizeSlider.value = String(targetFontMax);
    }

    if (Number(avatarSizeSlider.value) > targetAvatarMax) {
        avatarSizeSlider.value = String(targetAvatarMax);
    }

    applySetting('fontSize', fontSizeSlider.value);
    applySetting('avatarSize', avatarSizeSlider.value);
}


function autoResizeTextarea(event) {
    const ta = event.target;
    if (!ta) return;

    const modalContent = ta.closest('.modal-content');
    const originalScrollTop = modalContent ? modalContent.scrollTop : 0;
    const isMobileViewport = responsiveViewportQuery
        ? responsiveViewportQuery.matches
        : (typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT_PX : false);

    const cssMaxValue = getComputedStyle(ta).maxHeight;
    const cssMax = parseInt(cssMaxValue, 10);
    let maxH = Number.isFinite(cssMax) ? cssMax : Infinity;

    if (ta.id === 'message-input' && isMobileViewport && typeof window !== 'undefined') {
        if (typeof cssMaxValue === 'string' && /(?:d|s|l)?vh$/.test(cssMaxValue.trim()) && Number.isFinite(cssMax)) {
            maxH = window.innerHeight * (cssMax / 100);
        } else if (!Number.isFinite(maxH)) {
            maxH = window.innerHeight * 0.38;
        }
    }

    ta.style.height = 'auto';
    const sh = Math.ceil(ta.scrollHeight);
    const newH = Math.min(sh, maxH);
    ta.style.height = newH + 'px';

    if (ta.id === 'message-input') {
        ta.style.overflowY = (isMobileViewport && ta.scrollHeight > maxH) ? 'auto' : 'hidden';
    } else {
        ta.style.overflowY = (ta.scrollHeight > maxH ? 'auto' : 'hidden');
    }

    if (modalContent) {
        modalContent.scrollTop = originalScrollTop;
    }
}



    function handleTextareaEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.getElementById('dialog-btn').click();
    }
}



function createAvatarWithEffect(imageUrl, size, altText = '') {
  const container = document.createElement('div');
  container.className = 'avatar-container';
  container.style.width = size;
  container.style.height = size;

  if (imageUrl) {
    container.style.backgroundImage = `url('${imageUrl}')`;
    container.innerHTML = `<img src="${imageUrl}" alt="${altText}" loading="lazy">`;
  } else {
    container.innerHTML = `<div class="placeholder-icon">👤</div>`;
  }
  return container;
}



    function handleExport() {
  if (
    Object.keys(characters).length === 0 &&
    Object.keys(personas).length === 0 &&
    !(appSettings && appSettings.availableModels && appSettings.availableModels.length > 0)
  ) {
    showCustomAlert("There is nothing to export.");
    return;
  }
  const settingsToExport = {
    availableModels: (appSettings && Array.isArray(appSettings.availableModels) ? appSettings.availableModels : []).map(m => ({
      name: m.name || "",
      id: m.id || "",
      instructions: m.instructions || "",
      reminder: m.reminder || "",
      narratorReminder: m.narratorReminder || ""
    }))
  };
  const exportData = {
    version: 3, 
    characters: characters,
    personas: personas,
    appSettings: settingsToExport
  };
  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], {type: "application/json"});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  const date = new Date().toISOString().slice(0, 10);
  link.download = `casualcharacterchat_export_${date}.json`; 
  link.click();
  URL.revokeObjectURL(url);
}



  async function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) { return; }

    if (file.type === 'image/png') {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const externalCardJson = extractDataFromPng(arrayBuffer);
                
                if (externalCardJson) {
                        if (await showCustomConfirm("Character Card PNG detected. Do you want to import this single character?")) {
            const { dataURL } = await imageFileToWebp(file, 0.80); 
            const newCharacter = convertExternalCardToCCC(externalCardJson, dataURL); 
            if (characters[newCharacter.id]) {
                                showCustomAlert("A character with a similar generated ID already exists. Import aborted to prevent overwrite.");
                                return;
                            }
                            characters[newCharacter.id] = newCharacter;
                            await saveSingleCharacterToDB(newCharacter);
                            renderCharacterList();
                            showCustomAlert(`Successfully imported "${newCharacter.name}" from PNG Character Card!`);
                        }
                } else {
                    showCustomAlert("This PNG file does not seem to contain any character data.");
                }
            } catch (error) {
                showCustomAlert("Error processing the PNG file: " + error.message);
            }
        };
        reader.readAsArrayBuffer(file);
    } 
    
    else if (file.type === 'application/json') {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);

                if (importedData.spec && importedData.spec.startsWith('chara_card_v')) {
                    if (await showCustomConfirm("Character Card JSON detected. Do you want to import this single character?")) {
                        const newCharacter = convertExternalCardToCCC(importedData, null); 
                        if (characters[newCharacter.id]) {
                           showCustomAlert("A character with a similar generated ID already exists. Import aborted.");
                           return;
                        }
                        characters[newCharacter.id] = newCharacter;
                        await saveSingleCharacterToDB(newCharacter);
                        renderCharacterList();
                        showCustomAlert(`Successfully imported "${newCharacter.name}" from PNG Character Card!`);
                    }
                }
                else if (importedData.version === 3 && importedData.characters) {
                    const importedChars = importedData.characters || {};
                    const importedPersonas = importedData.personas || {};
                    const importedAppSettings = importedData.appSettings || null;
                    if (await showCustomConfirm("JSON backup file detected. Do you want to merge the imported data with your current collection?")) {
                        const initialCharCount = Object.keys(characters).length;
                        const initialPersonaCount = Object.keys(personas).length;
                        let charsAdded = 0, personasAdded = 0, charsSkipped = 0, personasSkipped = 0;
                        for (const charId in importedChars) {
                    if (!characters[charId]) {
                        characters[charId] = importedChars[charId];
                        await saveSingleCharacterToDB(importedChars[charId]); 
                        charsAdded++;
                    } else { charsSkipped++; }
                }
                for (const personaId in importedPersonas) {
                            if (!personas[personaId]) {
                                personas[personaId] = importedPersonas[personaId];
                                personasAdded++;
                            } else { personasSkipped++; }
                        }
                        let modelsAdded = 0, modelsSkipped = 0, modelsHydrated = 0;
                        if (importedAppSettings) {
                           appSettings = appSettings || {};
                           appSettings.availableModels = Array.isArray(appSettings.availableModels) ? appSettings.availableModels : [];
                           const existingById = {};
                           (appSettings.availableModels || []).forEach(m => {
                               if (m && m.id) existingById[m.id] = m;
                           });
                           const incoming = Array.isArray(importedAppSettings.availableModels) ? importedAppSettings.availableModels : [];
                           incoming.forEach(m => {
                               if (m && m.id && !existingById[m.id]) {
                                   appSettings.availableModels.push({
                                       name: m.name || "", id: m.id || "",
                                       instructions: m.instructions || "", reminder: m.reminder || "", narratorReminder: m.narratorReminder || ""
                                   });
                                   modelsAdded++;
                               } else if (m && m.id && existingById[m.id]) {
                                   const target = existingById[m.id];
                                   let updated = false;
                                   if ((!target.instructions || target.instructions.trim() === "") && (m.instructions && m.instructions.trim() !== "")) {
                                       target.instructions = m.instructions; updated = true;
                                   }
                                   if ((!target.reminder || target.reminder.trim() === "") && (m.reminder && m.reminder.trim() !== "")) {
                                       target.reminder = m.reminder; updated = true;
                                   }
                                   if ((!target.narratorReminder || target.narratorReminder.trim() === "") && (m.narratorReminder && m.narratorReminder.trim() !== "")) {
                                       target.narratorReminder = m.narratorReminder; updated = true;
                                   }
                                   if (updated) { modelsHydrated++; } else { modelsSkipped++; }
                               } else { modelsSkipped++; }
                           });
                           if (db) {
                               const transaction = db.transaction(['settings'], 'readwrite');
                               const store = transaction.objectStore('settings');
                               store.put({ key: 'appSettings', value: appSettings });
                           }
                           populateModelSelector();
                           if (typeof createModelEntry === 'function') {
                               modelListContainer.innerHTML = '';
                               (appSettings.availableModels || []).forEach(model => createModelEntry(model));
                           }
                        }
                        await savePersonasToDB();
                        renderCharacterList();
                        if (!personaListModal.classList.contains('hidden')) { openPersonaListModal(); }
                        showCustomAlert(
    `Import Complete!\n\n` +
    `Added from file: ${charsAdded} characters, ${personasAdded} personas.\n` +
    `Skipped duplicates: ${charsSkipped} characters, ${personasSkipped} personas.\n\n` +
    (importedAppSettings ? `Models added: ${modelsAdded}, skipped: ${modelsSkipped}\nPrompts hydrated: ${modelsHydrated}` : ``)
);
                    }
                }
                else {
                    showCustomAlert("Unknown or unsupported JSON format.");
                }
            } catch (error) {
                showCustomAlert("Error reading the JSON file: " + error.message);
            }
        };
        reader.readAsText(file);
    } 
    else {
        showCustomAlert("Please select a valid .json or .png file.");
    }
    
    event.target.value = '';
}





async function saveCharactersToDB() {
    if (!db) return;
    const transaction = db.transaction(['characters'], 'readwrite');
    const store = transaction.objectStore('characters');
    
    store.clear();

    for (const character of Object.values(characters)) {
        store.put(character);
    }

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}



async function saveSingleCharacterToDB(character) {
    if (!db) return;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['characters'], 'readwrite');
        const store = transaction.objectStore('characters');
        const request = store.put(character); 

        transaction.oncomplete = () => {
            resolve();
        };
        transaction.onerror = (event) => {
            console.error("Error saving single character:", event.target.error);
            reject(event.target.error);
        };
    });
}



async function deleteSingleCharacterFromDB(charId) {
    if (!db) return;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['characters'], 'readwrite');
        const store = transaction.objectStore('characters');
        store.delete(charId); 

        transaction.oncomplete = () => {
            resolve();
        };
        transaction.onerror = (event) => {
            console.error("Error deleting single character:", event.target.error);
            reject(event.target.error);
        };
    });
}



async function deleteMultipleCharactersFromDB(arrayOfIds) {
    if (!db || !arrayOfIds || arrayOfIds.length === 0) return;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['characters'], 'readwrite');
        const store = transaction.objectStore('characters');
        arrayOfIds.forEach(id => {
            store.delete(id);
        });

        transaction.oncomplete = () => {
            resolve();
        };
        transaction.onerror = (event) => {
            console.error("Error deleting multiple characters:", event.target.error);
            reject(event.target.error);
        };
    });
}



async function loadCharactersFromDB() {
    if (!db) return;
    const transaction = db.transaction(['characters'], 'readonly');
    const store = transaction.objectStore('characters');
    const allCharactersArray = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
    
    characters = allCharactersArray.reduce((obj, char) => {
        obj[char.id] = char;
        return obj;
    }, {});
}



async function savePersonasToDB() {
    if (!db) return;
    const transaction = db.transaction(['personas'], 'readwrite');
    const store = transaction.objectStore('personas');

    store.clear();

    for (const persona of Object.values(personas)) {
        store.put(persona);
    }

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}



function populateModelSelector() {
    const previouslySelectedModel = modelSelect.value;

    modelSelect.innerHTML = '';
    appSettings.availableModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        modelSelect.appendChild(option);
    });

    modelSelect.value = previouslySelectedModel || defaultSettings.model;
}



async function loadPersonasFromDB() {
    if (!db) return;
    const transaction = db.transaction(['personas'], 'readonly');
    const store = transaction.objectStore('personas');
    const allPersonasArray = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });

    personas = allPersonasArray.reduce((obj, persona) => {
        obj[persona.id] = persona;
        return obj;
    }, {});
}



function renderCharacterList(searchTerm = '') {
    const favoritesBar = document.getElementById('favorites-bar');
    const favoritesContainer = document.getElementById('favorites-bar-container');
    
    characterList.innerHTML = '';
    archivedCharacterList.innerHTML = ''; 
    favoritesBar.innerHTML = '';

    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    const allSortedCharacters = Object.values(characters).sort((a, b) => {
        return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
    });

    const favoriteCharacters = allSortedCharacters.filter(char => char.isFavorite && !char.isArchived); 
    if (favoriteCharacters.length > 0) {
        favoritesContainer.classList.remove('hidden');
        favoriteCharacters.forEach((character, index) => {
            const favElement = document.createElement('div');
            favElement.className = 'favorite-item';
            favElement.dataset.charId = character.id;
            const imageUrl = getImageUrl(character.avatar); 
favElement.innerHTML = `
  <div class="avatar-container">
    <img src="${imageUrl}" alt="${character.name}" class="${character.avatar ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
    <div class="placeholder-icon ${character.avatar ? 'hidden' : ''}">👤</div>
</div>
  <span>${character.name}</span>
`;

if (character.avatar) {
  const avatarContainer = favElement.querySelector('.avatar-container');
  avatarContainer.style.zIndex = index + 1;
}
            favElement.addEventListener('click', () => showChatList(character.id));
            favoritesBar.appendChild(favElement);
        });
    } else {
    favoritesContainer.classList.remove('hidden');
    favoritesBar.innerHTML = `<span class="favorites-placeholder">No Favorites selected</span>`;
}

    const nameSearchTerm = document.getElementById('search-input').value.toLowerCase();
const tagSearchTerm = document.getElementById('tag-search-input').value.toLowerCase();

const filteredCharacters = allSortedCharacters.filter(char => {
    const nameMatch = char.name.toLowerCase().includes(nameSearchTerm);
    const tagsMatch = (char.tags || '').toLowerCase().includes(tagSearchTerm);
    return nameMatch && tagsMatch;
});

    let archivedCount = 0;

    for (const character of filteredCharacters) {
        const charId = character.id;
        const charElement = document.createElement('div');
        charElement.classList.add('character-card');
        charElement.dataset.charId = charId;

        const isFavorite = character.isFavorite === true;
        const archiveButtonIcon = character.isArchived
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        const archiveButtonTitle = character.isArchived ? 'Retrieve from the archive' : 'Archive Character';

        const imageUrl = getImageUrl(character.avatar);
        const starSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
        charElement.innerHTML = `
            ${!character.isArchived ? `<button class="favorite-btn ${isFavorite ? 'is-favorite' : ''}" title="Mark as Favorite">${starSvg}</button>` : ''}
            <button class="archive-btn" title="${archiveButtonTitle}">${archiveButtonIcon}</button>
            <div class="card-image-container effect-container">
    <img src="${imageUrl}" alt="Avatar" class="${character.avatar ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
    <div class="placeholder-icon ${character.avatar ? 'hidden' : ''}">👤</div>
</div>
            <div class="card-name-container">
                <span>${character.name}</span>
            </div>`;

            if (character.avatar) {
  const imageContainer = charElement.querySelector('.card-image-container');
  imageContainer.style.backgroundImage = `url('${imageUrl}')`;
}

        charElement.addEventListener('click', (event) => {
            if (!event.target.classList.contains('favorite-btn') && !event.target.classList.contains('archive-btn')) {
                showChatList(charId);
            }
        });

        if (character.isArchived) {
            archivedCharacterList.appendChild(charElement);
            archivedCount++; 
        } else {
            characterList.appendChild(charElement);
        }
    }

    if (archivedCount > 0) {
        archiveSection.classList.remove('hidden');
    } else {
        archiveSection.classList.add('hidden');
    }

document.fonts.ready.then(() => {
    document.querySelectorAll('.card-name-container').forEach(container => {
        adjustFontSizeToFit(container);
    });
});

    adjustCardImageFit();
}



    function showChatList(charId) {
        const previousCharacterId = currentCharacterId;
        freezeLayout();
  currentCharacterId = charId;
  localStorage.setItem('activeCharacterId', charId);
  localStorage.removeItem('activeChatId');
  characterSelectionScreen.classList.add('is-inactive');
  chatListScreen.classList.remove('is-inactive');
  tutorialOnScreenChange('chat-list');
  chatScreen.classList.add('is-inactive');
  characterSelectionScreen.style.pointerEvents = 'none';
  chatListScreen.style.pointerEvents = 'auto';
  chatScreen.style.pointerEvents = 'none';
  const character = characters[charId];
  
  const backgroundUrl = getImageUrl(character.background);
  if (backgroundUrl) {
    chatListScreen.style.backgroundImage = `url('${backgroundUrl}')`;
    starsContainer.classList.remove('visible');
  } else {
    chatListScreen.style.backgroundImage = 'none';
    starsContainer.classList.add('visible');
  }

  const avatarImg = document.getElementById('chat-list-avatar');
  const nameH2 = document.getElementById('chat-list-character-name');
  
  const dashboardAvatarUrl = getImageUrl(character.avatar);
const avatarContainer = document.getElementById('chat-list-avatar-container');

avatarImg.onerror = () => {
    avatarContainer.classList.add('hidden');
    chatListAvatarPlaceholder.classList.remove('hidden');
};

if (dashboardAvatarUrl) {
    avatarImg.src = dashboardAvatarUrl; 
    smartObjectFit(avatarImg);
    avatarContainer.style.backgroundImage = `url('${dashboardAvatarUrl}')`;
    avatarContainer.classList.remove('hidden');
    chatListAvatarPlaceholder.classList.add('hidden');
} else {
    avatarContainer.classList.add('hidden');
    chatListAvatarPlaceholder.classList.remove('hidden');
    avatarContainer.style.backgroundImage = 'none';
}
  nameH2.textContent = character.name;
  chatSessionListDiv.innerHTML = '';
  if (character.chats && Object.keys(character.chats).length > 0) {
    const chatIds = Object.keys(character.chats).sort((a, b) => b.localeCompare(a));
    chatIds.forEach(chatId => {
      const chat = character.chats[chatId];
      const chatEntry = document.createElement('div');
      chatEntry.className = 'chat-session-entry';
      chatEntry.innerHTML = `
        <span class="chat-session-name" data-chat-id="${chatId}">${chat.name}</span>
        <div class="chat-session-actions">
          <button class="rename-chat-btn" data-chat-id="${chatId}">Rename</button>
          <button class="delete-chat-btn" data-chat-id="${chatId}">Delete</button>
        </div>`;
      chatSessionListDiv.appendChild(chatEntry);
    });
  } else {
    chatSessionListDiv.innerHTML = '<p style="color:rgb(233, 233, 233);">No chats yet.</p>';
  }
  document.querySelectorAll('.chat-session-name').forEach(nameSpan => {
  nameSpan.addEventListener('click', async (e) => {
    await startChat(charId, e.target.dataset.chatId);
  });
});
  document.querySelectorAll('.rename-chat-btn').forEach(button => {
    button.addEventListener('click', (e) => handleRenameChat(charId, e.target.dataset.chatId));
  });
  document.querySelectorAll('.delete-chat-btn').forEach(button => {
    button.addEventListener('click', (e) => handleDeleteChat(charId, e.target.dataset.chatId));
  });
  if (previousCharacterId !== charId) {
    chatListScreen.scrollTop = 0;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      unfreezeLayout();
    });
  });

}



    async function handleDeleteChat(charId, chatId) {
        const chatName = characters[charId].chats[chatId].name;
        if (await showCustomConfirm(`Are you sure you want to delete the chat "${chatName}"?`, true)) {
            delete characters[charId].chats[chatId];
            await saveSingleCharacterToDB(characters[charId]);
            showChatList(charId);
        }
    }



    function updateTokenCount() {
    if (!currentCharacterId || !currentChatId) return;
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat || !tokenTooltip) return;

    let contextText = '';
    if (chat.activePersonaId && personas[chat.activePersonaId]) {
        contextText += personas[chat.activePersonaId].description || '';
    }
    if (chat.memories) {
        contextText += chat.memories;
    }
    chat.history.forEach(msg => {
        contextText += msg.sender === 'user' ? msg.main : msg.variations[msg.activeVariant].main;
    });
    let totalTokens = Math.round(contextText.length / 4);

    let characterContextText = '';
    
    if (chat.participants) {
        chat.participants.forEach(participantId => {
            const participant = characters[participantId];
            if (participant && participant.description) {
                characterContextText += participant.description;
            }
        });
    }

    const mainCharacter = characters[currentCharacterId];
    if (mainCharacter && mainCharacter.lore) {
        characterContextText += mainCharacter.lore;
    }

    totalTokens += Math.round(characterContextText.length / 4);

    totalTokens += 2000;

    tokenTooltip.textContent = `Estimated Tokens in Context: ~${totalTokens}`;
}



function calculateCharacterTokens(character) {
    if (!character) return 0;

    let totalText = '';
    totalText += character.chatName || '';
    totalText += character.description || '';
    totalText += character.lore || '';
    totalText += character.instructions || '';
    totalText += character.reminder || '';
    totalText += character.narratorReminder || '';

    return Math.round(totalText.length / 4);
}

function updateEditorTokenCount() {
    if (!editorTokenCounter) return;

    const tempChar = {
        chatName: document.getElementById('chat-name').value,
        description: document.getElementById('char-description').value,
        lore: document.getElementById('char-lore').value,
        instructions: document.getElementById('char-instructions').value,
        reminder: document.getElementById('char-reminder').value,
        narratorReminder: document.getElementById('char-narrator-reminder').value
    };

    const estimatedTokens = calculateCharacterTokens(tempChar);
    editorTokenCounter.textContent = `Estimated Tokens: ~${estimatedTokens}`;
}



function updatePersonaEditorTokenCount() {
    if (!personaEditorTokenCounter) return;

    let totalText = '';
    totalText += document.getElementById('persona-name').value || '';
    totalText += document.getElementById('persona-description').value || '';

    const estimatedTokens = Math.round(totalText.length / 4);
    personaEditorTokenCounter.textContent = `Estimated Tokens: ~${estimatedTokens}`;
}



    
    function updateChatMemoriesButtonState() {
        if (!chatMemoriesBtn) return;
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        const hasMemories = !!(chat && chat.memories && chat.memories.trim());
        chatMemoriesBtn.classList.toggle('active', hasMemories);
        chatMemoriesBtn.setAttribute('title', hasMemories ? 'Chat Memories (active)' : 'Chat Memories');
    }



    function closeChatMemoriesModal() {
        if (chatMemoriesModal) {
            chatMemoriesModal.classList.add('hidden');
        }
    }



    function openChatMemoriesModal() {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat || !chatMemoriesModal || !chatMemoriesTextarea) return;

        chatMemoriesTextarea.value = chat.memories || '';
        chatMemoriesModal.classList.remove('hidden');
        chatMemoriesTextarea.focus();
        autoResizeTextarea({ target: chatMemoriesTextarea });
        chatMemoriesTextarea.selectionStart = chatMemoriesTextarea.selectionEnd = chatMemoriesTextarea.value.length;
    }



    async function saveChatMemories() {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat) return;

        chat.memories = (chatMemoriesTextarea?.value || '').trim();
        await saveSingleCharacterToDB(characters[currentCharacterId]);
        updateChatMemoriesButtonState();
        updateTokenCount();
        closeChatMemoriesModal();
    }


        
    async function handleRenameChat(charId, chatId) {
        const chat = characters[charId].chats[chatId];
        const newName = await showCustomPrompt("Enter a new name for the chat:", chat.name);
        if (newName && newName.trim() !== "") {
            chat.name = newName.trim();
            await saveSingleCharacterToDB(characters[charId]);
            showChatList(charId);
        }
    }



        function showMainScreen() {
    chatListScreen.classList.add('is-inactive');
    chatScreen.classList.add('is-inactive');
    characterSelectionScreen.classList.remove('is-inactive');
    characterSelectionScreen.style.pointerEvents = 'auto';
chatListScreen.style.pointerEvents = 'none';
chatScreen.style.pointerEvents = 'none';
    starsContainer.style.transition = 'none';
    starsContainer.classList.add('visible');
    setTimeout(() => {
        starsContainer.style.transition = 'opacity 0.5s ease-in-out';
    }, 10);
    currentCharacterId = null;
    localStorage.removeItem('activeCharacterId');
    localStorage.removeItem('activeChatId');
}



    function showCharacterSelection() {
        chatWindow.style.display = 'none';
    void chatWindow.offsetHeight; 
    chatWindow.style.display = 'flex';
    chatScreen.classList.add('is-inactive');
    characterSelectionScreen.style.pointerEvents = 'auto';
chatListScreen.style.pointerEvents = 'none';
chatScreen.style.pointerEvents = 'none';
    settingsPanel.classList.add('hidden'); 
    const lastCharId = localStorage.getItem('activeCharacterId');
    if (lastCharId && characters[lastCharId]) {
        showChatList(lastCharId);
    } else {
        characterSelectionScreen.classList.remove('is-inactive');
    }
    localStorage.removeItem('activeChatId');
    currentChatId = null;
}



let bulkSelectedCharIds = new Set();



function openBulkCharacterDeleteModal() {
  let modal = document.getElementById('bulkCharDeleteModal');
  bulkSelectedCharIds = new Set();

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bulkCharDeleteModal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '2200';

    const panel = document.createElement('div');
    panel.className = 'modal-content';
    panel.style.maxWidth = '600px';
    panel.style.width = 'min(600px, 92vw)';
    panel.innerHTML = `
      <h2>Bulk delete characters</h2>
      <p>Choose the characters you want to delete:</p>

      <div class="modal-search-container" style="display:flex; align-items:center; gap:10px;">
        <input type="search" id="bulkCharSearch" class="modal-search-input" placeholder="🔎 Search Character…">
        <label style="display:flex; align-items:center; gap:6px; font-size:16px; color:#dcddde;">
          <input id="bulkCharSelectAll" type="checkbox" />
          <span>Select all</span>
        </label>
      </div>

      <div id="bulkCharList" style="display:flex; flex-direction:column; gap:10px; max-height:50vh; overflow-y:auto; padding-right:10px;"></div>

      <div class="form-buttons">
        <button type="button" id="bulkCharDeleteBtn">Delete selected</button>
        <button type="button" id="cancel-bulk-delete-btn">Cancel</button>
      </div>
    `;
    modal.appendChild(panel);
    document.body.appendChild(modal);

    panel.querySelector('#bulkCharDeleteBtn').addEventListener('click', performBulkCharacterDelete);
    panel.querySelector('#bulkCharSelectAll').addEventListener('change', (e) => toggleSelectAllCharacters(e.target.checked));
    panel.querySelector('#bulkCharSearch').addEventListener('input', renderBulkCharacterDeleteList);
    panel.querySelector('#cancel-bulk-delete-btn').addEventListener('click', () => modal.remove());
  }

  renderBulkCharacterDeleteList();
  modal.style.display = 'flex';
}



function renderBulkCharacterDeleteList() {
  const list = document.getElementById('bulkCharList');
  if (!list) return;

  const q = (document.getElementById('bulkCharSearch')?.value || '').toLowerCase().trim();
  const entries = Object.entries(characters || {});
  const filtered = q ? entries.filter(([id, c]) => (c?.name || '').toLowerCase().includes(q)) : entries;

  list.innerHTML = '';
  filtered
    .sort((a, b) => (a[1]?.name || '').localeCompare(b[1]?.name || '', 'de', { sensitivity: 'base' }))
    .forEach(([id, c]) => {
      const avatarSrc = c?.avatar ? (typeof getImageUrl === 'function' ? getImageUrl(c.avatar) : c.avatar) : null;
      const avatarHtml = `
    <img src="${avatarSrc}" alt="Avatar" class="${avatarSrc ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
    <div class="placeholder-icon ${avatarSrc ? 'hidden' : ''}">👤</div>
`;

      const row = document.createElement('label');
      row.className = 'participant-option-btn';
      row.style.justifyContent = 'space-between';
      row.style.width = '100%';
      row.style.boxSizing = 'border-box';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '15px';
      left.innerHTML = `${avatarHtml}<span>${escapeHtml(c?.name || '(unnamed)')}</span>`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'bulkCharCheckbox';
      cb.value = id;

      cb.checked = bulkSelectedCharIds.has(id);

      cb.addEventListener('change', (e) => {
        if (e.target.checked) bulkSelectedCharIds.add(id);
        else bulkSelectedCharIds.delete(id);
        updateSelectAllState();
      });

      row.appendChild(left);
      row.appendChild(cb);
      list.appendChild(row);
    });

  updateSelectAllState();
  list.querySelectorAll('img').forEach(img => {
  img.style.objectFit = 'cover';
  img.style.objectPosition = 'center';
});
}



function toggleSelectAllCharacters(checked) {
  const boxes = document.querySelectorAll('#bulkCharList .bulkCharCheckbox');
  boxes.forEach(cb => {
    cb.checked = checked;
    if (checked) bulkSelectedCharIds.add(cb.value);
    else bulkSelectedCharIds.delete(cb.value);
  });
  updateSelectAllState();
}



function updateSelectAllState() {
  const selectAll = document.getElementById('bulkCharSelectAll');
  if (!selectAll) return;

  const boxes = document.querySelectorAll('#bulkCharList .bulkCharCheckbox');
  const total = boxes.length;
  const selected = Array.from(boxes).filter(cb => cb.checked).length;

  selectAll.indeterminate = selected > 0 && selected < total;
  selectAll.checked = total > 0 && selected === total;
}



async function performBulkCharacterDelete() {
  const ids = Array.from(bulkSelectedCharIds);
  if (ids.length === 0) {
    showCustomAlert('No characters selected.');
    return;
  }
  if (!await showCustomConfirm(`Delete ${ids.length} selected character(s)? This cannot be undone.`, true)) return;

  const toDelete = new Set(ids);

  ids.forEach(id => { delete characters[id]; });

  for (const ownerId in characters) {
    const chats = characters[ownerId]?.chats || {};
    for (const chatId in chats) {
      const chat = chats[chatId];
      if (Array.isArray(chat?.participants)) {
        chat.participants = chat.participants.filter(pid => !toDelete.has(pid));
      }
    }
  }

  if (typeof currentCharacterId !== 'undefined' && toDelete.has(currentCharacterId)) {
    try { currentCharacterId = null; } catch (_) {}
    try { currentChatId = null; } catch (_) {}
  }

  try {
    await deleteMultipleCharactersFromDB(ids);
    renderCharacterList();
  } catch (e) {
    showCustomAlert('Error while deleting: ' + (e?.message || e));
  }

  const modal = document.getElementById('bulkCharDeleteModal');
  if (modal) modal.remove();

  showCustomAlert(`Deleted ${ids.length} character(s).`);
}



function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}



function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}



async function imageFileToWebp(file, quality = 0.80) {
  const originalDataURL = await fileToDataURL(file);

  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, width, height);

  let blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  );

  let dataURL;
  if (blob) {
    dataURL = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
    if (typeof source.close === 'function') source.close();
    return { blob, dataURL, originalDataURL };
  }

  blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion failed'))), 'image/jpeg', 0.80)
  );
  dataURL = canvas.toDataURL('image/jpeg', 0.80);
  if (typeof source.close === 'function') source.close();
  return { blob, dataURL, originalDataURL };
}



    async function startChat(charId, chatId) {
    clearActiveGroupParticipant();
    starsContainer.classList.remove('visible');
    currentCharacterId = charId;
    currentChatId = chatId;
    localStorage.setItem('activeCharacterId', charId);
    localStorage.setItem('activeChatId', chatId);

    const character = characters[charId];
    const chat = character.chats[chatId];

    if (!chat.participants) chat.participants = [charId];
    if (chat.activePersonaId === undefined) chat.activePersonaId = null;
    if (chat.memories === undefined) chat.memories = '';
    closeChatMemoriesModal();
    
    selectPersonaBtn.classList.remove('hidden');

    chatListScreen.classList.add('is-inactive');
    characterSelectionScreen.classList.add('is-inactive');
    chatScreen.classList.remove('is-inactive');
    tutorialOnScreenChange('chat');
    characterSelectionScreen.style.pointerEvents = 'none';
chatListScreen.style.pointerEvents = 'none';
chatScreen.style.pointerEvents = 'auto';

    chatCharacterName.textContent = chat.name;

    const headerAvatarUrl = character.avatar;

chatAvatar.onerror = () => {
    chatAvatar.classList.add('hidden');
    chatAvatarPlaceholder.classList.remove('hidden');
};

if (headerAvatarUrl) {
    chatAvatar.src = getImageUrl(headerAvatarUrl);
    smartObjectFit(chatAvatar);
    chatAvatar.classList.remove('hidden');
    chatAvatarPlaceholder.classList.add('hidden');
} else {
    chatAvatar.classList.add('hidden');
    chatAvatarPlaceholder.classList.remove('hidden');
}

    const chatScreenDiv = document.getElementById('chat-screen');
    if (character.background) {
    chatScreenDiv.style.backgroundImage = `url('${getImageUrl(character.background)}')`;
    starsContainer.classList.remove('visible');
} else {
    chatScreenDiv.style.backgroundImage = 'none';
    starsContainer.classList.add('visible');
}

    chatWindow.innerHTML = '';
    if (!chat.history) chat.history = [];

    chat.history.forEach(message => {
        displayMessage(message);
    });

    renderParticipantIcons();
    updateChatMemoriesButtonState();
    updateTokenCount();
    await saveSingleCharacterToDB(character);
if (window.__scrollToBottomNextStartChat) {
    setTimeout(() => {
        chatWindow.scrollTop = chatWindow.scrollHeight;
        window.__scrollToBottomNextStartChat = false;
    }, 0);
} else {
    const k = `chatScrollPos:${currentCharacterId}:${currentChatId}`;
const saved = localStorage.getItem(k);
if (saved !== null) {
  setTimeout(() => {
    chatWindow.scrollTop = parseInt(saved, 10);
  }, 0);
}
}

}



async function createNewChat(initialMessage = null, scenarioName = null) {
    if (!currentCharacterId) return;
    const character = characters[currentCharacterId];
    if (!character.chats) {
        character.chats = {};
    }
    const newChatId = 'chat-' + Date.now();
    let newName;
    if (scenarioName) {
        const timeOptions = { hour: '2-digit', minute: '2-digit' };
        newName = `${scenarioName} - ${new Date().toLocaleDateString('en-EN')}, ${new Date().toLocaleTimeString('en-EN', timeOptions)}`;
    } else {
        const timeOptions = { hour: '2-digit', minute: '2-digit' };
        newName = `New Chat - ${new Date().toLocaleDateString('en-EN')}, ${new Date().toLocaleTimeString('en-EN', timeOptions)}`;
    }
    let history = [];
    if (initialMessage) {
        const messageObject = {
            id: 'msg-' + Date.now(),
            sender: 'ai',
            type: 'dialog',
            variations: [{ main: initialMessage, think: null }],
            activeVariant: 0
        };
        history.push(messageObject);
    }
    character.chats[newChatId] = {
        id: newChatId,
        name: newName,
        history: history,
        memories: '',
        participants: [currentCharacterId],
        activePersonaId: null
    };
    await saveSingleCharacterToDB(character);
    window.__scrollToBottomNextStartChat = true;
await startChat(currentCharacterId, newChatId);
}



function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeModelOutput(text) {
    if (text === null || text === undefined) return '';
    let s = typeof text === 'string' ? text : String(text);
    // Strip null bytes and ASCII control characters (keep tab \x09, newline \x0A, carriage return \x0D)
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Strip common LLM special tokens that may leak into output as artifacts
    s = s.replace(/<\|im_start\|>/g, '').replace(/<\|im_end\|>/g, '');
    s = s.replace(/<\|begin_of_text\|>/g, '').replace(/<\|end_of_text\|>/g, '');
    s = s.replace(/<\|eot_id\|>/g, '').replace(/<\|endoftext\|>/g, '');
    s = s.replace(/<\|start_header_id\|>[\s\S]*?<\|end_header_id\|>/g, '');
    return s;
}

function stripThinkTags(text) {
    const safe = sanitizeModelOutput(text);
    if (!safe) return '';
    return safe.replace(/<\s*\/?\s*think\s*>/gi, '').trim();
}

function ensureThinkBlockElements(messageElement) {
    if (!messageElement) return { thinkBlock: null, thinkContent: null };

    let thinkBlock = messageElement.querySelector('.think-block');
    let thinkContent = thinkBlock ? thinkBlock.querySelector('.think-block-content') : null;

    if (!thinkBlock) {
        thinkBlock = document.createElement('details');
        thinkBlock.className = 'think-block hidden';
        thinkBlock.innerHTML = `<summary class="think-block-summary">Show Thoughts</summary><div class="think-block-content"></div>`;

        const mainContent = messageElement.querySelector('.main-content');
        if (mainContent && mainContent.parentNode === messageElement) {
            messageElement.insertBefore(thinkBlock, mainContent);
        } else {
            messageElement.appendChild(thinkBlock);
        }
        thinkContent = thinkBlock.querySelector('.think-block-content');
    } else if (!thinkContent) {
        thinkContent = document.createElement('div');
        thinkContent.className = 'think-block-content';
        thinkBlock.appendChild(thinkContent);
    }

    return { thinkBlock, thinkContent };
}

function extractMainFromReasoning(reasoningText) {
    const safe = sanitizeModelOutput(reasoningText);
    if (!safe) return '';
    const closeIdx = safe.toLowerCase().indexOf("</think>");
    if (closeIdx !== -1) {
        const tail = safe.slice(closeIdx + "</think>".length).trim();
        if (tail) return stripThinkTags(tail);
    }
    return stripThinkTags(safe);
}

function formatSubString(text) {
    if (!text) return '';

    const markdownImageRegex = /!\[.*?\]\((https?:\/\/[^\s<>]+\.(?:jpg|jpeg|png|gif|webp|avif)[^\s<>]*)\)/gi;
    const bareImageUrlRegex = /(https?:\/\/[^\s<>]+\.(?:jpg|jpeg|png|gif|webp|avif)[^\s<>]*)/gi;

    let imagesHtml = '';
    let processedText = text;

    processedText = processedText.replace(markdownImageRegex, (match, url) => {
        imagesHtml += `<div class="message-image-container"><img src="${url}" alt="Image from chat" loading="lazy"></div>`;
        return ''; 
    });

    processedText = processedText.replace(bareImageUrlRegex, (url) => {
        imagesHtml += `<div class="message-image-container"><img src="${url}" alt="Image from chat" loading="lazy"></div>`;
        return ''; 
    });

    const safeRemainingText = escapeHtml(processedText.trim())
        .replace(/"(.*?)"/g, '<span class="dialogue">"$1"</span>')
        .replace(/“(.*?)”/g, '<span class="dialogue">“$1”</span>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/((?:https?:\/\/|www\.)[^\s<>()]+)/gi, (url) => {
            let href = url;
            if (href.toLowerCase().startsWith('www.')) {
                href = 'http://' + href;
            }
            return `<a href="${href}" target="_blank" style="text-decoration: underline; color: inherit;">${url}</a>`;
        });

    return imagesHtml + safeRemainingText;
}

function createTypewriter(charsPerFrame = 3) {
    let target = '';
    let displayed = 0;
    let rafId = null;
    let onRender = null;

    function tick() {
        if (displayed < target.length && onRender) {
            displayed = Math.min(displayed + charsPerFrame, target.length);
            onRender(target.slice(0, displayed));
        }
        rafId = displayed < target.length ? requestAnimationFrame(tick) : null;
    }

    return {
        init(text) { target = text; displayed = text.length; },
        update(text, renderer) {
            onRender = renderer;
            if (text.length > target.length) {
                target = text;
                if (!rafId) rafId = requestAnimationFrame(tick);
            }
        },
        flush(text, renderer) {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            target = text;
            displayed = text.length;
            renderer(text);
        }
    };
}

function createTypingIndicator() {
    const container = document.createElement('span');
    container.className = 'typing-dots';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'typing-dot';
        container.appendChild(dot);
    }
    return container;
}

function setBubbleLoading(mainContentEl, isLoading, options = {}) {
    if (!mainContentEl) return;
    const preserveText = options.preserveText || false;

    if (isLoading) {
        if (!preserveText) {
            mainContentEl.classList.add('is-loading');
            mainContentEl.innerHTML = '';
        }
        if (!mainContentEl.querySelector('.typing-dots')) {
            const indicator = createTypingIndicator();
            if (preserveText) indicator.classList.add('after-text');
            mainContentEl.appendChild(indicator);
        }
    } else {
        mainContentEl.classList.remove('is-loading');
        const indicator = mainContentEl.querySelector('.typing-dots');
        if (indicator) indicator.remove();
    }
}



function displayMessage(message) {
    let messageWrapper = document.createElement('div');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.dataset.messageId = message.id;

    let mainText, thinkText;
    if (message.sender === 'user') {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        const personaId = chat?.activePersonaId;
        const persona = personaId ? personas[personaId] : null;
        const personaAvatarUrl = persona?.avatar;

        if (personaAvatarUrl) {
            messageWrapper.classList.add('user-message-container');
            messageElement.classList.add('user-message');
            mainText = message.main;

            const avatarContainer = document.createElement('div');
avatarContainer.className = 'message-avatar effect-container';
avatarContainer.style.backgroundImage = `url('${getImageUrl(personaAvatarUrl)}')`;

const avatarImg = document.createElement('img');
avatarImg.src = getImageUrl(personaAvatarUrl);
avatarImg.title = persona.name;
smartObjectFit(avatarImg);

const placeholderDiv = document.createElement('div');
placeholderDiv.className = 'message-avatar placeholder-icon hidden';
placeholderDiv.innerHTML = '👤';

avatarImg.onerror = () => {
    avatarImg.style.display = 'none';
    placeholderDiv.classList.remove('hidden');
    avatarContainer.classList.remove('effect-container');
    avatarContainer.style.backgroundImage = 'none';
};

avatarContainer.appendChild(avatarImg);
avatarContainer.appendChild(placeholderDiv); 
messageWrapper.appendChild(messageElement);
messageWrapper.appendChild(avatarContainer);
        } else {

            messageWrapper = messageElement;
            messageWrapper.classList.add('user-message');
            mainText = message.main;
        }
        thinkText = null;

    } else { 
        messageWrapper.classList.add('ai-message-container');
        messageElement.classList.add('ai-message');
        if (message.type === 'story') {
            messageElement.classList.add('story-message');
        }
        const activeVariant = message.variations[message.activeVariant];
        const sanitizedMain = sanitizeModelOutput(activeVariant.main);
        if (sanitizedMain !== activeVariant.main) {
            activeVariant.main = sanitizedMain;
        }
        mainText = sanitizedMain;

        if (activeVariant.think) {
            const sanitizedThink = sanitizeModelOutput(activeVariant.think);
            if (sanitizedThink !== activeVariant.think) {
                activeVariant.think = sanitizedThink;
            }
            thinkText = sanitizedThink;
        } else {
            thinkText = null;
        }
        
        if (message.type !== 'story') { 
            const speakerId = message.speakerId || currentCharacterId;
            const speakerCharacter = characters[speakerId];
            
            if (speakerCharacter) {
                const avatarUrl = speakerCharacter.avatar;
                const avatarContainer = document.createElement('div');
avatarContainer.className = 'message-avatar'; 

const placeholderDiv = document.createElement('div');
placeholderDiv.className = 'message-avatar placeholder-icon';
placeholderDiv.innerHTML = '👤';
placeholderDiv.title = speakerCharacter.name || 'Unknown';

if (avatarUrl) {
    avatarContainer.classList.add('effect-container');
    avatarContainer.style.backgroundImage = `url('${getImageUrl(avatarUrl)}')`;

    const avatarImg = document.createElement('img');
    avatarImg.src = getImageUrl(avatarUrl);
    avatarImg.title = speakerCharacter.name;
    smartObjectFit(avatarImg);

    placeholderDiv.classList.add('hidden');

    avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        placeholderDiv.classList.remove('hidden');
        avatarContainer.classList.remove('effect-container');
        avatarContainer.style.backgroundImage = 'none';
    };

    avatarContainer.appendChild(avatarImg);
}

avatarContainer.appendChild(placeholderDiv);
messageWrapper.appendChild(avatarContainer);
            }
        }
    }

    if (message.sender === 'ai' && thinkText) {
        const { thinkBlock, thinkContent } = ensureThinkBlockElements(messageElement);
        if (thinkBlock && thinkContent) {
            thinkBlock.classList.remove('hidden');
            thinkContent.innerHTML = `&lt;think&gt;<br>${formatSubString(thinkText)}<br>&lt;/think&gt;`;
        }
    }
    
    const mainContent = document.createElement('div');
    mainContent.className = 'main-content';
    mainContent.dataset.editPart = 'main';
    const shouldShowLoader = message.sender === 'ai' && message.isStreaming && mainText === '...';
    if (shouldShowLoader) {
        setBubbleLoading(mainContent, true);
    } else if (typeof mainText === 'string') {
        mainContent.innerHTML = formatSubString(mainText);
    }
    messageElement.appendChild(mainContent);

    const actionGroup = document.createElement('div');
    actionGroup.className = 'message-action-group';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-message-btn message-action-btn';
    deleteBtn.title = 'Delete message and following';
    deleteBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>`;
    actionGroup.appendChild(deleteBtn);
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-message-btn message-action-btn';
    editBtn.title = 'Edit message';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>`;
    actionGroup.appendChild(editBtn);
    messageElement.appendChild(actionGroup);

    if (message.sender === 'ai') {
        const controls = document.createElement('div');
        controls.className = 'message-controls';
        if (message.isStreaming) controls.classList.add('is-streaming');

        if (message.variations.length > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'prev-variant-btn';
            prevBtn.innerHTML = '‹';
            prevBtn.disabled = message.activeVariant === 0;

            const counter = document.createElement('span');
            counter.className = 'variant-counter';
            counter.textContent = `${message.activeVariant + 1}/${message.variations.length}`;

            const nextBtn = document.createElement('button');
            nextBtn.className = 'next-variant-btn';
            nextBtn.innerHTML = '›';
            nextBtn.disabled = message.activeVariant >= message.variations.length - 1;

            controls.appendChild(prevBtn);
            controls.appendChild(counter);
            controls.appendChild(nextBtn);
        }

        const regenBtn = document.createElement('button');
        regenBtn.className = 'regenerate-btn';
        regenBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>`;
        regenBtn.title = 'Regenerate Response';
        controls.appendChild(regenBtn);
        const continueBtn = document.createElement('button');
        continueBtn.className = 'continue-btn';
        continueBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M3.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L9.293 8 3.646 2.354a.5.5 0 0 1 0-.708z"/><path fill-rule="evenodd" d="M7.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L13.293 8 7.646 2.354a.5.5 0 0 1 0-.708z"/></svg>`;
        continueBtn.title = 'Continue Response';
        controls.appendChild(continueBtn);
        messageElement.appendChild(controls);
    }
    
    if (message.sender !== 'user' || !characters[currentCharacterId]?.chats?.[currentChatId]?.activePersonaId) {

        if(message.sender === 'ai') messageWrapper.appendChild(messageElement);
    }

    chatWindow.appendChild(messageWrapper);
    return messageWrapper;
}



async function addNewMessage(rawMessage, sender, type = 'dialog', forceScroll = false) {
    const messageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat) return;

    let messageObject;

    if (sender === 'user') {
        messageObject = { id: messageId, sender: 'user', main: rawMessage };
    } else { 
        const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
        const thinkMatch = rawMessage.match(thinkRegex);
        let thinkText = null;
        let mainText = rawMessage;
        if (thinkMatch) {
            thinkText = thinkMatch[1].trim();
            mainText = rawMessage.replace(thinkRegex, '').trim();
        }
        mainText = sanitizeModelOutput(mainText);
        if (thinkText) {
            thinkText = sanitizeModelOutput(thinkText);
        }
        messageObject = {
            id: messageId,
            sender: 'ai',
            type: type, 
            variations: [{ main: mainText, think: thinkText }],
            activeVariant: 0
        };
    }

    if (!chat.history) chat.history = [];
    chat.history.push(messageObject);
    await saveCharactersToDB();
    displayMessage(messageObject);
    if (forceScroll) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
}



async function handleChatSubmit(type) {
    const userMessageRaw = messageInput.value.trim();
    messageInput.value = '';
    autoResizeTextarea({ target: messageInput });
    let mainCharacter = characters[currentCharacterId];
    let chat = mainCharacter.chats[currentChatId];
    let targetCharId = currentCharacterId;
    let finalUserMessage = userMessageRaw;

    hideGroupCharDropdown();

    if (chat?.participants && activeGroupParticipantId && chat.participants.includes(activeGroupParticipantId)) {
        targetCharId = activeGroupParticipantId;
    }

    let messageForAPI;
    let historyForAPI;
    let lastMessageInChat = chat.history && chat.history.length > 0 ? chat.history[chat.history.length - 1] : null;

    if (finalUserMessage) {
        addNewMessage(finalUserMessage, 'user', type, true);
        messageForAPI = finalUserMessage;
        historyForAPI = chat.history.slice(0, -1).map(msg => {
    const activePersona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
    if (msg.sender === 'ai') {
        const speaker = characters[msg.speakerId || currentCharacterId];
        const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
        let processedText = applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName);
        processedText = applyUserPlaceholder(processedText, activePersona);
        return { sender: 'ai', main: `${speakerName}: ${processedText}` };
    } else { 
        const userName = activePersona?.name || 'User';
        let processedText = applyUserPlaceholder(msg.main, activePersona);
        return { sender: 'user', main: `${userName}: ${processedText}` };
    }
});
    } else { 
    if (!chat.history || chat.history.length === 0) {
        messageForAPI = "Introduce yourself in typical manner and start the roleplay with a creative scenario."; 
        historyForAPI = []; 
    } else {
        const historyCopy = [...chat.history];
        const lastMessage = historyCopy.pop();
        const lastVariant = lastMessage.variations ? lastMessage.variations[lastMessage.activeVariant] : null;
        const lastMainText = lastMessage.main || (lastVariant ? lastVariant.main : '');
        const trimmedLastMain = (lastMainText || '').trim();
        messageForAPI = trimmedLastMain || "Continue the scene plausibly based on the latest turn.";
        if (lastMessage.sender === 'ai') {
            messageForAPI += "\n\n(Continue the scene from your previous reply with new content. Do not repeat earlier sentences and drive the scene actively forward.)";
        }
        historyForAPI = historyCopy.map(msg => {
            if (msg.sender === 'ai') {
                const speaker = characters[msg.speakerId || currentCharacterId];
                const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
                return { sender: 'ai', main: `${speakerName}: ${applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName)}` };
            }
            const persona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
            const userName = persona?.name || 'User';
            return { sender: 'user', main: `${userName}: ${msg.main}` };
        });
    }
}

    const targetCharacter = characters[targetCharId];
    const charNameForAI = targetCharacter.chatName || targetCharacter.name;
    const activePersonaId = chat.activePersonaId;
    const persona = activePersonaId ? personas[activePersonaId] : null;

    const currentModelId = modelSelect.value || defaultSettings.model;
    const modelSettings = appSettings.availableModels.find(m => m.id === currentModelId);

    loadingIndicator.classList.remove('hidden');
    dialogBtn.disabled = true;
    storyBtn.disabled = true;
    stopStreamBtn.classList.remove('hidden');
    const MAX_RETRIES = 90;
    currentStreamController = new AbortController();
    let fullReply = '';
    let streamAbortedByUser = false;
    const newMessageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    let isFirstChunk = true;
    const aiMessageObject = {
        id: newMessageId,
        sender: 'ai',
        type: type,
        speakerId: targetCharId,
        variations: [{ main: '...', think: null }],
        activeVariant: 0,
        isStreaming: true,
        streamingVariant: 0
    };
    if (!chat.history) chat.history = [];
    chat.history.push(aiMessageObject);
    await saveSingleCharacterToDB(mainCharacter);
    const messageWrapper = displayMessage(aiMessageObject);
    let mainContentEl = messageWrapper.querySelector('.main-content');
    let thinkBlockEl = messageWrapper.querySelector('.think-block');
    let thinkBlockContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
    const regenBtn = messageWrapper.querySelector('.regenerate-btn');
    const continueBtn = messageWrapper.querySelector('.continue-btn');
    const controls = messageWrapper.querySelector('.message-controls');
    if (regenBtn) {
        regenBtn.disabled = true;
        regenBtn.classList.add('is-loading');
    }
    if (continueBtn) {
        continueBtn.disabled = true;
    }
    if (controls) controls.classList.add('is-streaming');
    const mainContentElement = messageWrapper.querySelector('.main-content');
    let thinkBlockElement = messageWrapper.querySelector('.think-block');
const coldStartTimer = setTimeout(() => {
    const messageToUpdate = chat.history.find(m => m.id === newMessageId);
    if (messageToUpdate && messageToUpdate.variations[0].main === '...') {
        messageToUpdate.variations[0].main = "Connecting to AI Model - Please wait or regenerate the message.";
        updateSingleMessageView(newMessageId);
    }
}, 20000); 
const serverHungTimer = setTimeout(() => {
    const messageToUpdate = chat.history.find(m => m.id === newMessageId);
    if (messageToUpdate && messageToUpdate.variations[0].main.includes("Connecting to AI Model")) {
        messageToUpdate.variations[0].main = "The AI provider may be experiencing issues - Please wait a moment or try again later.";
        updateSingleMessageView(newMessageId);
    }
}, 70000);

const clearStreamTimers = () => {
    clearTimeout(coldStartTimer);
    clearTimeout(serverHungTimer);
};

const startTime = Date.now();
    chatWindow.scrollTop = chatWindow.scrollHeight;
    chatWindow._autoScroll = true;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (!currentStreamController) { streamAbortedByUser = true; break; }
        try {
            console.log(`Send request (Attempt ${attempt}/${MAX_RETRIES})...`);
            let fullSystemPrompt = '';

            if (modelSettings && modelSettings.instructions && modelSettings.instructions.trim() !== '') {
    fullSystemPrompt += `--- GLOBAL AI INSTRUCTIONS ---\n${
        applyUserPlaceholder(applyCharPlaceholder(modelSettings.instructions.trim(), charNameForAI), persona)
    }\n\n`;
}

            if (persona) {
    fullSystemPrompt += `--- EXACT USER PERSONA ---\nName: ${persona.name}\nDescription: ${applyUserPlaceholder(applyCharPlaceholder(persona.description, charNameForAI), persona)}\n---\n\n`;
}
            if (type === 'story') {
    fullSystemPrompt += `[SYSTEM META-INSTRUCTION: Respond only as a third-person omniscient narrator.\nDo not speak as any character and narrate the scene objectively.]\n\n`;
    fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
    chat.participants.forEach(pid => {
        const pChar = characters[pid];
        if (pChar) {
            fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
        }
    });

    const mainCharacterForLore = characters[currentCharacterId];
    if (mainCharacterForLore && mainCharacterForLore.lore) {
        fullSystemPrompt += `\n--- LORE / BACKGROUND KNOWLEDGE ---\n${mainCharacterForLore.lore.trim()}\n\n`;
    }
} else {
if (chat.participants && chat.participants.length > 1) {
    fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
    chat.participants.forEach(pid => {
        const pChar = characters[pid];
        if (pChar) {
            fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
        }
    });
    fullSystemPrompt += `\n`;
}
                if (targetCharId !== currentCharacterId) {
                    fullSystemPrompt += `[SYSTEM META-INSTRUCTION: The user is addressing the character '${charNameForAI}' directly.\nRespond only as '${charNameForAI}' and do not respond as any other character.]\n\n`;
                }
                if (targetCharacter.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(targetCharacter.instructions, charNameForAI), persona).trim()}\n\n`;
                if (targetCharacter.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${targetCharacter.description.trim()}\n\n`;
                if (targetCharacter.lore) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${targetCharacter.lore.trim()}\n\n`;
            }

            const chatMemoriesText = (chat.memories || '').trim();
            if (chatMemoriesText) {
                fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${chatMemoriesText}\n\n`;
            }

            let finalMessageForAPI = messageForAPI;
const globalDialogReminder = applyUserPlaceholder(applyCharPlaceholder(
    (modelSettings && modelSettings.reminder) ? modelSettings.reminder.trim() : '',
    charNameForAI
), persona);
const globalNarratorReminder = applyUserPlaceholder(applyCharPlaceholder(
    (modelSettings && modelSettings.narratorReminder) ? modelSettings.narratorReminder.trim() : '',
    charNameForAI
), persona);
let characterDialogReminder = applyUserPlaceholder((targetCharacter.reminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
let characterNarratorReminder = applyUserPlaceholder((targetCharacter.narratorReminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
            const combinedDialogReminder = [globalDialogReminder, characterDialogReminder].filter(Boolean).join('\n');
            const combinedNarratorReminder = [globalNarratorReminder, characterNarratorReminder].filter(Boolean).join('\n');

            const characterForAPI = { ...targetCharacter, description: fullSystemPrompt };
            const currentTemperature = temperatureSlider.value;
            const currentModel = modelSelect.value;
            const lastMessageInHistory = chat.history[chat.history.length - 1];

const apiKeyToSend = (modelSettings && modelSettings.apiKey) || appSettings.apiKey;
const targetApiUrlToSend = (modelSettings && modelSettings.targetApiUrl) || DEFAULT_API_URL;
const isLocal = targetApiUrlToSend && (
    targetApiUrlToSend.includes('localhost') ||
    targetApiUrlToSend.includes('127.0.0.1')
);

const reminderContent = type === 'dialog' ? combinedDialogReminder : combinedNarratorReminder;
const lastUserContent = (isLocal && reminderContent)
    ? `${finalMessageForAPI}\n[${reminderContent}]`
    : finalMessageForAPI;
const messages = [
    { role: 'system', content: characterForAPI.description },
    ...historyForAPI.map(h => ({ role: h.sender === 'ai' ? 'assistant' : 'user', content: h.main })),
    { role: 'user', content: lastUserContent },
    ...(!isLocal && reminderContent ? [{ role: 'user', content: `[${reminderContent}]` }] : [])
];
const fetchUrl = targetApiUrlToSend;
const fetchBody = JSON.stringify({
    model: currentModel,
    messages,
    temperature: parseFloat(currentTemperature),
    stream: true,
    options: {
        num_ctx: 32768
    }
});
const response = await fetch(fetchUrl, {
    method: 'POST',
    headers: isLocal
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeyToSend}` },
    signal: currentStreamController.signal,
    body: fetchBody
});

    clearStreamTimers();
            if (response.status === 429) {
                const waitTime = Math.min(1 * attempt, 1);
const elapsedTime = Date.now() - startTime;
if (elapsedTime > 20000) {
    const messageToUpdate = chat.history.find(m => m.id === newMessageId);
    if (messageToUpdate) {
        messageToUpdate.variations[0].main = `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
        updateSingleMessageView(newMessageId);
    }
}
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                if (attempt === MAX_RETRIES) throw new Error("AI Model did not respond after multiple retries. Please try again later or choose another Model.");
                continue;
            }
            if (!response.ok) throw new Error(await response.text());
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            fullReply = '';
            const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
            let reasoningBuf = '';
            let thinkOpened = false;
            let sseBuffer = '';
            const mainTypewriter = createTypewriter();
            const thinkTypewriter = createTypewriter();
            while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';
    const currentMessageElement = document.querySelector(`[data-message-id="${newMessageId}"]`);
    mainContentEl = currentMessageElement ? currentMessageElement.querySelector('.main-content') : null;
    thinkBlockEl = currentMessageElement ? currentMessageElement.querySelector('.think-block') : null;
    thinkBlockContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
    const ensureThinkBlockPresent = () => {
        if (!currentMessageElement) return false;
        if (!thinkBlockEl || !thinkBlockContentEl) {
            const refs = ensureThinkBlockElements(currentMessageElement);
            thinkBlockEl = refs.thinkBlock;
            thinkBlockContentEl = refs.thinkContent;
        }
        return !!(thinkBlockEl && thinkBlockContentEl);
    };
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const dataContent = line.slice(5).trim();
        if (dataContent === '[DONE]') { sseBuffer = ''; break; }
        if (isFirstChunk) {
    const messageToUpdate = chat.history.find(m => m.id === newMessageId);
    if (messageToUpdate) {
        messageToUpdate.variations[0].main = '';
        messageToUpdate.isStreaming = false;
        messageToUpdate.streamingVariant = null;
    }
    if (mainContentEl) {
        setBubbleLoading(mainContentEl, false);
        mainContentEl.innerHTML = '';
    }
    isFirstChunk = false;
}
        try {
            const parsed = JSON.parse(dataContent);
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            if (delta?.content) {
                fullReply += delta.content;

                const openIdx = fullReply.search(/<think>/i);
                const closeIdx = fullReply.toLowerCase().indexOf("</think>");

                let mainOnly;
                let streamThinkText = null;
                let streamThinkComplete = false;

                if (openIdx === -1 && closeIdx !== -1) {
                    // Headless think: content before </think> is reasoning, after is main
                    mainOnly = fullReply.slice(closeIdx + "</think>".length).trimStart();
                    streamThinkText = fullReply.slice(0, closeIdx).trim();
                    streamThinkComplete = true;
                } else if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
                    // Complete <think>...</think> inline block
                    mainOnly = (fullReply.slice(0, openIdx) + fullReply.slice(closeIdx + "</think>".length)).trim();
                    streamThinkText = fullReply.slice(openIdx + "<think>".length, closeIdx).trim();
                    streamThinkComplete = true;
                } else if (openIdx !== -1) {
                    // <think> opened but </think> not yet received — keep think content out of main
                    mainOnly = fullReply.slice(0, openIdx).trim();
                    streamThinkText = fullReply.slice(openIdx + "<think>".length).trim();
                    streamThinkComplete = false;
                } else {
                    mainOnly = fullReply.trim();
                }

                const sanitizedMainOnly = sanitizeModelOutput(mainOnly);
                aiMessageObject.variations[0].main = sanitizedMainOnly;
                mainTypewriter.update(sanitizedMainOnly, t => { if (mainContentEl) { mainContentEl.innerHTML = formatSubString(t); if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });

                if (thinkEnabled && streamThinkText !== null && reasoningBuf === '' && ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    thinkBlockEl.open = true;
                    const sanitizedThink = sanitizeModelOutput(streamThinkText);
                    thinkTypewriter.update(sanitizedThink, t => { if (thinkBlockContentEl) thinkBlockContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                    if (streamThinkComplete) {
                        aiMessageObject.variations[0].think = sanitizedThink;
                    }
                }
            }
            if (delta?.reasoning) {
                reasoningBuf += delta.reasoning;
                if (thinkEnabled && ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    thinkBlockEl.open = true;
                    const sanitizedReasoning = sanitizeModelOutput(reasoningBuf.trim());
                    thinkTypewriter.update(sanitizedReasoning, t => { if (thinkBlockContentEl) thinkBlockContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                    aiMessageObject.variations[0].think = sanitizedReasoning;
                }
            }
        } catch {
            continue;
        }
    }
}
            const hasAnyReplyText = fullReply.trim() !== '' || reasoningBuf.trim() !== '';
            if (hasAnyReplyText) {
                console.log(`Successful Response after ${attempt} attempts.`);
                const finalThinkMatch = fullReply.match(thinkRegex);
                const finalVariant = aiMessageObject.variations[0];
                const streamMainSnapshot = typeof finalVariant.main === 'string' ? finalVariant.main.trim() : '';
                let finalMainText = streamMainSnapshot
                    ? sanitizeModelOutput(streamMainSnapshot)
                    : sanitizeModelOutput(fullReply.replace(thinkRegex, '').trim());
                finalVariant.main = finalMainText;
                let finalThink = aiMessageObject.variations[0].think
                    ? sanitizeModelOutput(aiMessageObject.variations[0].think)
                    : null;

                if (reasoningBuf.trim()) {
                    finalThink = sanitizeModelOutput(reasoningBuf.trim());
                } else if (finalThinkMatch) {
                    finalThink = sanitizeModelOutput(finalThinkMatch[1].trim());
                }

                if (!finalThink) {
  const hasOpen = /<think>/i.test(fullReply);
  const cIdx = fullReply.toLowerCase().indexOf("</think>");
  if (!hasOpen && cIdx !== -1) {
    finalThink = sanitizeModelOutput(fullReply.slice(0, cIdx).trim());
    const tail = fullReply.slice(cIdx + "</think>".length).trimStart();
    finalMainText = sanitizeModelOutput(tail);
  }
}
                let thinkBlockContentFinal = thinkBlockElement ? thinkBlockElement.querySelector('.think-block-content') : null;
                if (finalThink && !thinkBlockElement) {
  const refs = ensureThinkBlockElements(messageWrapper);
  thinkBlockElement = refs.thinkBlock;
  thinkBlockContentFinal = refs.thinkContent;
}
                if (!finalThink && thinkBlockContentFinal) {
  const domThinkText = thinkBlockContentFinal.textContent || '';
  const cleanedDomThink = sanitizeModelOutput(domThinkText.replace(/<\s*\/?\s*think\s*>/gi, '').trim());
  if (cleanedDomThink) {
    finalThink = cleanedDomThink;
  }
}
                if ((!finalMainText || finalMainText.trim() === '') && reasoningBuf.trim()) {
                    finalMainText = sanitizeModelOutput(extractMainFromReasoning(reasoningBuf));
                }

                if (!thinkEnabled) { finalThink = null; }
                finalVariant.main = finalMainText;
                finalVariant.think = finalThink;
                mainTypewriter.flush(finalMainText || '', t => { if (mainContentElement) mainContentElement.innerHTML = formatSubString(t); });

                if (thinkBlockElement) {
                    if (finalThink) {
                        thinkBlockElement.classList.remove('hidden');
                        if (thinkBlockContentFinal) {
                            thinkTypewriter.flush(finalThink, t => { thinkBlockContentFinal.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                        }
                        thinkBlockElement.open = false;
                    } else {
                        thinkBlockElement.classList.add('hidden');
                        thinkBlockElement.open = false;
                    }
                }

                await saveSingleCharacterToDB(mainCharacter);
                playNotificationSound();
                updateTokenCount();
                break;
            } else {
                console.log(`Attempt ${attempt} resulted in an empty response. Retry...`);
                if (attempt < MAX_RETRIES) await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
    clearStreamTimers();
    if (error.name === 'AbortError') {
        console.log('Fetch aborted (Submit).');
        streamAbortedByUser = true;
        break;
    }
    console.error(`Error on attempt ${attempt}:`, error.message);
    const isTemporaryError = (error.message && error.message.includes('maximum capacity')) || (error.message && error.message.includes('Failed to fetch'));
    if (isTemporaryError && attempt < MAX_RETRIES) {
        console.log('Request failed or rate-limited. Retrying...');
        await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
        let errorMsg = `An unexpected error occurred. Please try regenerating the response or start a new chat. If the problem persists, please check the FAQ.`;
        if (error.message.includes('Failed to fetch')) {
            errorMsg = "Could not connect to the AI provider. Please check your API key and internet connection, then try again.";
        }
        aiMessageObject.variations[0].main = errorMsg;
        if(mainContentEl) mainContentEl.innerHTML = errorMsg;
        await saveSingleCharacterToDB(mainCharacter);
        break;
    }
}
    }
    clearStreamTimers();
    aiMessageObject.isStreaming = false;
    aiMessageObject.streamingVariant = null;
    setBubbleLoading(mainContentEl, false);

    const variant0 = aiMessageObject?.variations ? aiMessageObject.variations[0] : null;
    const variantMain = variant0 && typeof variant0.main === 'string' ? variant0.main.trim() : '';
    const variantThink = variant0 && typeof variant0.think === 'string' ? variant0.think.trim() : '';
    const hasMeaningfulVariant = (variantMain && variantMain !== '...') || variantThink;
    const hasAnyReplyContent = hasMeaningfulVariant || fullReply.trim() !== '';

    if (streamAbortedByUser && !hasAnyReplyContent) {
        // Aborted before any content arrived — remove the empty bubble entirely
        chat.history = chat.history.filter(m => m.id !== newMessageId);
        if (messageWrapper && messageWrapper.parentNode) messageWrapper.remove();
        await saveSingleCharacterToDB(mainCharacter);
    } else if (!hasAnyReplyContent) {
        const errorMsg = `AI Model did not respond to the request. Please try the following steps:

• Re-enter your default API key (or model-specific API key) in the app settings by copy & paste to ensure that it's correct.
• Check the request limits per minute/per day of the provider you're using, especially in free plans. Connection fails when limits are exceeded.
• Try sending a message again later in case the model is overloaded. Also, use other AI models to see if the AI model itself was the problem.
• In some cases your API provider might have a temporary problem. Try another provider/API key to see if your priveder was the problem.
• Check the FAQ section (help button on main screen) for further details to this error.`;
        aiMessageObject.variations[0].main = errorMsg;
        if (mainContentEl) mainContentEl.innerHTML = errorMsg;
        await saveSingleCharacterToDB(mainCharacter);
    }
    if (!streamAbortedByUser || hasAnyReplyContent) {
        const finalMessageEl = document.querySelector(`[data-message-id="${newMessageId}"]`);
        if (finalMessageEl) {
            const regenBtn = finalMessageEl.querySelector('.regenerate-btn');
            if (regenBtn) { regenBtn.disabled = false; regenBtn.classList.remove('is-loading'); }
            const continueBtn = finalMessageEl.querySelector('.continue-btn');
            if (continueBtn) { continueBtn.disabled = false; continueBtn.classList.remove('is-loading'); }
            const finalControls = finalMessageEl.querySelector('.message-controls');
            if (finalControls) finalControls.classList.remove('is-streaming');
        }
    }
    loadingIndicator.classList.add('hidden');
    dialogBtn.disabled = false;
    storyBtn.disabled = false;
    stopStreamBtn.classList.add('hidden');
    currentStreamController = null;
}



async function handleRegenerate(messageId) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat) return;
    const messageIndex = chat.history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

let mainContentEl = null;
let thinkBlockEl = null;
let thinkContentEl = null;
let thinkOpened = false;
let isFirstChunk = true;
let sseBuffer = '';
const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
if (messageElement) {
    mainContentEl = messageElement.querySelector('.main-content');
    thinkBlockEl = messageElement.querySelector('.think-block');
    thinkContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
    const regenBtn = messageElement.querySelector('.regenerate-btn');
    if (regenBtn) { regenBtn.disabled = true; regenBtn.classList.add('is-loading'); }
    const continueBtn = messageElement.querySelector('.continue-btn');
    if (continueBtn) continueBtn.disabled = true;
    const regenControls = messageElement.querySelector('.message-controls');
    if (regenControls) regenControls.classList.add('is-streaming');
}

    loadingIndicator.classList.remove('hidden');
    stopStreamBtn.classList.remove('hidden');
    dialogBtn.disabled = true;
    storyBtn.disabled = true;
    const message = chat.history[messageIndex];
    const messageType = message.type || 'dialog';
    const speakerId = message.speakerId || currentCharacterId;
    const speakerCharacter = characters[speakerId];
    const charNameForAI = speakerCharacter.chatName || speakerCharacter.name;

    if(messageElement) {
        const regenBtn = messageElement.querySelector('.regenerate-btn');
    const continueBtn = messageElement.querySelector('.continue-btn');
    const prevBtn = messageElement.querySelector('.prev-variant-btn');
    const nextBtn = messageElement.querySelector('.next-variant-btn');
    const counter = messageElement.querySelector('.variant-counter');
    if (regenBtn) {
        regenBtn.disabled = true;
        regenBtn.classList.add('is-loading');
    }
    if (continueBtn) {
        continueBtn.disabled = true;
    }
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (counter) counter.style.display = 'none';
    }
    
    message.variations.push({ main: '...', think: null });
    message.activeVariant = message.variations.length - 1;
    message.isStreaming = true;
    message.streamingVariant = message.activeVariant;
    updateSingleMessageView(messageId);
    if (thinkBlockEl) thinkBlockEl.open = false;
    const promptHistory = chat.history.slice(0, messageIndex);
    const lastUserMessageInHistory = promptHistory.slice().reverse().find(m => m.sender === 'user');
    const userMessageForAPI = lastUserMessageInHistory ? lastUserMessageInHistory.main : '';
    const historyForAPIcall = lastUserMessageInHistory ? promptHistory.slice(0, promptHistory.lastIndexOf(lastUserMessageInHistory)) : promptHistory;
    const activePersonaId = chat.activePersonaId;
    const persona = activePersonaId ? personas[activePersonaId] : null;
    const currentModelId = modelSelect.value || defaultSettings.model;
    const modelSettings = appSettings.availableModels.find(m => m.id === currentModelId);
    const mappedHistoryForAPI = historyForAPIcall.map(msg => {
    const activePersona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
    if (msg.sender === 'ai') {
        const speaker = characters[msg.speakerId || currentCharacterId];
        const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
        let processedText = applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName);
        processedText = applyUserPlaceholder(processedText, activePersona);
        return { sender: 'ai', main: `${speakerName}: ${processedText}` };
    } else { 
        const userName = activePersona?.name || 'User';
        let processedText = applyUserPlaceholder(msg.main, activePersona);
        return { sender: 'user', main: `${userName}: ${processedText}` };
    }
});

    let messageForAPIRegen = userMessageForAPI;
const globalDialogReminder = applyUserPlaceholder(applyCharPlaceholder(
    (modelSettings && modelSettings.reminder) ? modelSettings.reminder.trim() : '',
    charNameForAI
), persona);
const globalNarratorReminder = applyUserPlaceholder(applyCharPlaceholder(
    (modelSettings && modelSettings.narratorReminder) ? modelSettings.narratorReminder.trim() : '',
    charNameForAI
), persona);
let characterDialogReminder = applyUserPlaceholder((speakerCharacter.reminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
let characterNarratorReminder = applyUserPlaceholder((speakerCharacter.narratorReminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
    const combinedDialogReminder = [globalDialogReminder, characterDialogReminder].filter(Boolean).join('\n');
    const combinedNarratorReminder = [globalNarratorReminder, characterNarratorReminder].filter(Boolean).join('\n');

    const characterForAPI = { ...speakerCharacter };
    let fullSystemPrompt = '';

    if (modelSettings && modelSettings.instructions && modelSettings.instructions.trim() !== '') {
  fullSystemPrompt += `--- GLOBAL AI INSTRUCTIONS ---\n${
    applyUserPlaceholder(applyCharPlaceholder(modelSettings.instructions.trim(), charNameForAI), persona)
  }\n\n`;
}

    const hasCustomNarratorReminder = speakerCharacter.narratorReminder && speakerCharacter.narratorReminder.trim() !== '';
    if (messageType === 'story' && !hasCustomNarratorReminder) {
        fullSystemPrompt += `[SYSTEM INSTRUCTION: Respond only as a third-person omniscient narrator.\nDo not speak as any main character and narrate the scene objectively.]\n\n`;
    }
    if (persona) {
        fullSystemPrompt += `--- EXACT USER PERSONA ---\nName: ${persona.name}\nDescription: ${applyUserPlaceholder(applyCharPlaceholder(persona.description, charNameForAI), persona)}\n---\n\n`;
    }
    if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
    if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${characterForAPI.description.trim()}\n\n`;
    if (characterForAPI.lore) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${characterForAPI.lore.trim()}\n\n`;
    const chatMemoriesText = (chat.memories || '').trim();
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${chatMemoriesText}\n\n`;
    }
    characterForAPI.description = fullSystemPrompt;
    const MAX_RETRIES = 90;
    currentStreamController = new AbortController();
    let fullReply = '';
    let newVariant = null;
    let streamAbortedByUser = false;

const coldStartTimer = setTimeout(() => {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate && messageToUpdate.variations[message.activeVariant].main === '...') {
        messageToUpdate.variations[message.activeVariant].main = "Connecting to AI Model - Please wait or regenerate the message.";
        updateSingleMessageView(messageId);
    }
}, 20000); 

const serverHungTimer = setTimeout(() => {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate && messageToUpdate.variations[message.activeVariant].main.includes("Connecting to AI Model")) {
        messageToUpdate.variations[message.activeVariant].main = "The AI provider may be experiencing issues - Please wait a moment or try again later.";
        updateSingleMessageView(messageId);
    }
}, 70000);

const clearStreamTimers = () => {
    clearTimeout(coldStartTimer);
    clearTimeout(serverHungTimer);
};

const startTime = Date.now();
    chatWindow._autoScroll = true;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (!currentStreamController) { streamAbortedByUser = true; break; }
        try {
            console.log(`Regenerate request (Attempt ${attempt}/${MAX_RETRIES})...`);

            const currentModel = modelSelect.value;
            const currentTemperature = temperatureSlider.value;
            const apiKeyToSend = (modelSettings && modelSettings.apiKey) || appSettings.apiKey;
const targetApiUrlToSend = (modelSettings && modelSettings.targetApiUrl) || DEFAULT_API_URL;
const isLocal = targetApiUrlToSend && (
    targetApiUrlToSend.includes('localhost') ||
    targetApiUrlToSend.includes('127.0.0.1')
);

const reminderContent = messageType === 'dialog' ? combinedDialogReminder : combinedNarratorReminder;
const lastUserContent = (isLocal && reminderContent)
    ? `${messageForAPIRegen}\n[${reminderContent}]`
    : messageForAPIRegen;
const messages = [
    { role: 'system', content: characterForAPI.description },
    ...mappedHistoryForAPI.map(h => ({ role: h.sender === 'ai' ? 'assistant' : 'user', content: h.main })),
    { role: 'user', content: lastUserContent },
    ...(!isLocal && reminderContent ? [{ role: 'user', content: `[${reminderContent}]` }] : [])
];
const fetchUrl = targetApiUrlToSend;
const fetchBody = JSON.stringify({
    model: currentModelId,
    messages,
    temperature: parseFloat(currentTemperature),
    stream: true,
    options: {
        num_ctx: 32768
    }
});
const response = await fetch(fetchUrl, {
    method: 'POST',
    headers: isLocal
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeyToSend}` },
    signal: currentStreamController.signal,
    body: fetchBody
});
            clearStreamTimers();
            if (response.status === 429) {
                const waitTime = Math.min(1 * attempt, 1);
const elapsedTime = Date.now() - startTime;
if (elapsedTime > 20000) {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate) {
        messageToUpdate.variations[message.activeVariant].main = `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
        updateSingleMessageView(messageId);
    }
}
await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
if (attempt === MAX_RETRIES) throw new Error("AI Model did not respond after multiple retries. Please try again later or choose another Model.");
continue;
            }
            if (!response.ok) throw new Error(await response.text());
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let mainContentEl = messageElement?.querySelector('.main-content');
            let thinkBlockEl = messageElement?.querySelector('.think-block');
            let thinkBlockContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
            let isFirstChunk = true
            let sseBuffer = '';
            fullReply = '';
            let reasoningBuf = '';
            let thinkOpened = false;
            const mainTypewriter = createTypewriter();
            const thinkTypewriter = createTypewriter();
            while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';
    const currentMessageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    mainContentEl = currentMessageElement ? currentMessageElement.querySelector('.main-content') : null;
    thinkBlockEl = currentMessageElement ? currentMessageElement.querySelector('.think-block') : null;
    thinkContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
    const ensureThinkBlockPresent = () => {
        if (!currentMessageElement) return false;
        if (!thinkBlockEl || !thinkContentEl) {
            const refs = ensureThinkBlockElements(currentMessageElement);
            thinkBlockEl = refs.thinkBlock;
            thinkContentEl = refs.thinkContent;
        }
        return !!(thinkBlockEl && thinkContentEl);
    };
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const dataContent = line.slice(5).trim();
        if (dataContent === '[DONE]') { sseBuffer = ''; break; }
        if (isFirstChunk) {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate) {
        messageToUpdate.variations[message.activeVariant].main = '';
        messageToUpdate.isStreaming = false;
        messageToUpdate.streamingVariant = null;
    }
    if (mainContentEl) {
        setBubbleLoading(mainContentEl, false);
        mainContentEl.innerHTML = '';
    }
    isFirstChunk = false;
}
        try {
            const parsed = JSON.parse(dataContent);
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            if (delta?.content) {
                fullReply += delta.content;

                const openIdx = fullReply.search(/<think>/i);
                const closeIdx = fullReply.toLowerCase().indexOf("</think>");

                let mainOnly;
                let streamThinkText = null;
                let streamThinkComplete = false;

                if (openIdx === -1 && closeIdx !== -1) {
                    mainOnly = fullReply.slice(closeIdx + "</think>".length).trimStart();
                    streamThinkText = fullReply.slice(0, closeIdx).trim();
                    streamThinkComplete = true;
                } else if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
                    mainOnly = (fullReply.slice(0, openIdx) + fullReply.slice(closeIdx + "</think>".length)).trim();
                    streamThinkText = fullReply.slice(openIdx + "<think>".length, closeIdx).trim();
                    streamThinkComplete = true;
                } else if (openIdx !== -1) {
                    mainOnly = fullReply.slice(0, openIdx).trim();
                    streamThinkText = fullReply.slice(openIdx + "<think>".length).trim();
                    streamThinkComplete = false;
                } else {
                    mainOnly = fullReply.trim();
                }

                const sanitizedMainOnly = sanitizeModelOutput(mainOnly);
                mainTypewriter.update(sanitizedMainOnly, t => { if (mainContentEl) { mainContentEl.innerHTML = formatSubString(t); if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
                message.variations[message.activeVariant].main = sanitizedMainOnly;
                newVariant = { main: sanitizedMainOnly, think: null };

                if (thinkEnabled && streamThinkText !== null && reasoningBuf === '' && ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                    const sanitizedThink = sanitizeModelOutput(streamThinkText);
                    thinkTypewriter.update(sanitizedThink, t => { if (thinkContentEl) thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                    if (streamThinkComplete) {
                        message.variations[message.activeVariant].think = sanitizedThink;
                        newVariant.think = sanitizedThink;
                    }
                }
            }
            if (delta?.reasoning) {
                reasoningBuf += delta.reasoning;
                if (thinkEnabled && ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                    const sanitizedReasoning = sanitizeModelOutput(reasoningBuf.trim());
                    thinkTypewriter.update(sanitizedReasoning, t => { if (thinkContentEl) thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                    message.variations[message.activeVariant].think = sanitizedReasoning;
                    newVariant.think = sanitizedReasoning;
                }
            }
        } catch {
            continue;
        }
    }
}
            const hasAnyReplyText = fullReply.trim() !== '' || reasoningBuf.trim() !== '';
            if (hasAnyReplyText) {
                console.log(`Successful response after ${attempt} attempts.`);
                const finalThinkMatch = fullReply.match(/<think>([\s\S]*?)<\/think>/i);
                const finalVariant = message.variations[message.activeVariant];
                let thinkBlockEl = messageElement?.querySelector('.think-block');
                let thinkBlockContentFinal = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
                const streamMainSnapshot = typeof finalVariant.main === 'string' ? finalVariant.main.trim() : '';
                let finalMainText = streamMainSnapshot
                    ? sanitizeModelOutput(streamMainSnapshot)
                    : sanitizeModelOutput(fullReply.replace(/<think>([\s\S]*?)<\/think>/i, '').trim());

                let finalThink = finalVariant.think ? sanitizeModelOutput(finalVariant.think) : null;
                if (reasoningBuf.trim()) {
                    finalThink = sanitizeModelOutput(reasoningBuf.trim());
                } else if (finalThinkMatch) {
                    finalThink = sanitizeModelOutput(finalThinkMatch[1].trim());
                }

                if (!finalThink) {
                    const hasOpen = /<think>/i.test(fullReply);
                    const cIdx = fullReply.toLowerCase().indexOf("</think>");
                    if (!hasOpen && cIdx !== -1) {
                        finalThink = sanitizeModelOutput(fullReply.slice(0, cIdx).trim());
                        const mainTail = fullReply.slice(cIdx + "</think>".length).trimStart();
                        finalMainText = sanitizeModelOutput(mainTail);
                    }
                }

                if (finalThink && !thinkBlockEl) {
                    const refs = ensureThinkBlockElements(messageElement);
                    thinkBlockEl = refs.thinkBlock;
                    thinkBlockContentFinal = refs.thinkContent;
                }

                if (!finalThink && thinkBlockContentFinal) {
                    const domThinkText = thinkBlockContentFinal.textContent || '';
                    const cleanedDomThink = sanitizeModelOutput(domThinkText.replace(/<\s*\/?\s*think\s*>/gi, '').trim());
                    if (cleanedDomThink) {
                        finalThink = cleanedDomThink;
                    }
                }
                if ((!finalMainText || finalMainText.trim() === '') && reasoningBuf.trim()) {
                    finalMainText = sanitizeModelOutput(extractMainFromReasoning(reasoningBuf));
                }

                if (!thinkEnabled) { finalThink = null; }
                finalVariant.main = finalMainText;
                finalVariant.think = finalThink;
                newVariant = { main: finalMainText, think: finalThink };

                if (thinkBlockEl) {
                    if (finalThink) {
                        thinkBlockEl.classList.remove('hidden');
                        if (thinkBlockContentFinal) {
                            thinkTypewriter.flush(finalThink, t => { thinkBlockContentFinal.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                        }
                        thinkBlockEl.open = false;
                    } else {
                        thinkBlockEl.classList.add('hidden');
                        thinkBlockEl.open = false;
                    }
                }
                break;
            } else {
                console.log(`Attempt ${attempt} resulted in an empty response. Retry...`);
                if (attempt < MAX_RETRIES) await new Promise(resolve => setTimeout(resolve, 1000));
            }
} catch (error) {
    clearStreamTimers();
    if (error.name === 'AbortError') {
        console.log('Fetch aborted (Regen).');
        streamAbortedByUser = true;
        break;
    }
    console.error(`Error during regeneration (Attempt ${attempt}):`, error.message);
    const isTemporaryError = (error.message && error.message.includes('maximum capacity')) || (error.message && error.message.includes('Failed to fetch'));
    if (isTemporaryError && attempt < MAX_RETRIES) {
        console.log('Request failed or rate-limited. Retrying...');
        await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
        let errorMsg = `AI Model did not respond to the request. Please try the following steps:

• Re-enter your default API key (or model-specific API key) in the app settings by copy & paste to ensure that it's correct.
• Check the request limits per minute/per day of the provider you're using, especially in free plans. Connection fails when limits are exceeded.
• Try sending a message again later in case the model is overloaded. Also, use other AI models to see if the AI model itself was the problem.
• In some cases your API provider might have a temporary problem. Try another provider/API key to see if your priveder was the problem.
• Check the FAQ section (help button on main screen) for further details to this error.`;
        if (error.message.includes('Failed to fetch')) {
            errorMsg = "Could not connect to the AI provider. Please check your API key and internet connection, then try again.";
        }
        if(mainContentEl) mainContentEl.innerHTML = errorMsg;
        message.variations[message.variations.length - 1] = { main: errorMsg, think: null };
        await saveSingleCharacterToDB(characters[currentCharacterId]);
        break;
    }
}
    }
    clearStreamTimers();
    message.isStreaming = false;
    message.streamingVariant = null;
    setBubbleLoading(mainContentEl, false);
    if (streamAbortedByUser && !newVariant) {
        // Aborted before any content arrived — revert the empty new variant
        if (message.variations.length > 1) {
            message.variations.pop();
            message.activeVariant = message.variations.length - 1;
        }
    } else if (newVariant) {
        message.variations[message.variations.length - 1] = newVariant;
        message.activeVariant = message.variations.length - 1;
        if (!streamAbortedByUser) {
            playNotificationSound();
            updateTokenCount();
        }
    }
    const finalMessageElement = document.querySelector(`[data-message-id="${messageId || newMessageId}"]`);
    if (finalMessageElement) {
        const regenBtn = finalMessageElement.querySelector('.regenerate-btn');
        const continueBtn = finalMessageElement.querySelector('.continue-btn');
        if (regenBtn) {
            regenBtn.disabled = false;
            regenBtn.classList.remove('is-loading');
        }
        if (continueBtn) {
            continueBtn.disabled = false;
            continueBtn.classList.remove('is-loading');
        }

        const controlsContainer = finalMessageElement.querySelector('.message-controls');
        if (controlsContainer) controlsContainer.classList.remove('is-streaming');
        let prevBtn = finalMessageElement.querySelector('.prev-variant-btn');
        let counter = finalMessageElement.querySelector('.variant-counter');
        let nextBtn = finalMessageElement.querySelector('.next-variant-btn');

        if (message.variations.length > 1) {
            if (!prevBtn && !counter && !nextBtn && controlsContainer && regenBtn) {
                prevBtn = document.createElement('button');
                prevBtn.className = 'prev-variant-btn';
                prevBtn.innerHTML = '‹';

                counter = document.createElement('span');
                counter.className = 'variant-counter';

                nextBtn = document.createElement('button');
                nextBtn.className = 'next-variant-btn';
                nextBtn.innerHTML = '›';

                controlsContainer.insertBefore(prevBtn, regenBtn);
                controlsContainer.insertBefore(counter, regenBtn);
                controlsContainer.insertBefore(nextBtn, regenBtn);
            } else {
                if (prevBtn) prevBtn.style.display = '';
                if (nextBtn) nextBtn.style.display = '';
                if (counter) counter.style.display = '';
            }
        } else {
            if (prevBtn) prevBtn.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
            if (counter) counter.style.display = 'none';
        }
    }
    loadingIndicator.classList.add('hidden');
    stopStreamBtn.classList.add('hidden');
    dialogBtn.disabled = false;
    storyBtn.disabled = false;
    currentStreamController = null;
    await saveSingleCharacterToDB(characters[currentCharacterId]);
    updateSingleMessageView(messageId);
}



async function handleContinue(messageId) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat) return;
    const messageIndex = chat.history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

let mainContentEl = null;
let thinkBlockEl = null;
let thinkContentEl = null;
let thinkOpened = false;
let isFirstChunk = true;
let sseBuffer = '';
const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
if (messageElement) {
    mainContentEl = messageElement.querySelector('.main-content');
    thinkBlockEl = messageElement.querySelector('.think-block');
    thinkContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
    const regenBtn = messageElement.querySelector('.regenerate-btn');
    if (regenBtn) regenBtn.disabled = true;
    const continueBtn = messageElement.querySelector('.continue-btn');
    if (continueBtn) {
        continueBtn.disabled = true;
        continueBtn.classList.add('is-loading');
    }
    const contControls = messageElement.querySelector('.message-controls');
    if (contControls) contControls.classList.add('is-streaming');
}

    loadingIndicator.classList.remove('hidden');
    stopStreamBtn.classList.remove('hidden');
    dialogBtn.disabled = true;
    storyBtn.disabled = true;
    const message = chat.history[messageIndex];
    message.isStreaming = true;
    message.streamingVariant = message.activeVariant;
    if (mainContentEl) {
        setBubbleLoading(mainContentEl, true, { preserveText: true });
    }
    const activeVariant = message.variations[message.activeVariant];
    const originalText = activeVariant.main;

    const speakerId = message.speakerId || currentCharacterId;
    const speakerCharacter = characters[speakerId];
    const charNameForAI = speakerCharacter.chatName || speakerCharacter.name;
    const messageType = message.type || 'dialog';
    if(messageElement) {
        const regenBtn = messageElement.querySelector('.regenerate-btn');
    const continueBtn = messageElement.querySelector('.continue-btn');
    const prevBtn = messageElement.querySelector('.prev-variant-btn');
    const nextBtn = messageElement.querySelector('.next-variant-btn');
    const counter = messageElement.querySelector('.variant-counter');

    if (regenBtn) {
        regenBtn.disabled = true;
    }
    if (continueBtn) {
        continueBtn.disabled = true;
        continueBtn.classList.add('is-loading');
    }
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (counter) counter.style.display = 'none';
    }

    const historyCopy = chat.history.slice(0, messageIndex + 1);
    const lastMessage = historyCopy.pop(); 
    let messageForAPI = lastMessage.variations[lastMessage.activeVariant].main; 
    messageForAPI += "\n\n(Please drive the current point of the scene actively forward to the next point of the scene. Keep it concise and write only one short paragraph maximum. In case a sentence or dialog was cut off, complete it seamlessly (without three dots '...') and then move on with fresh sentences. Do not repeat any of the previous sentences.)";
    const activePersonaId = chat.activePersonaId;
    const persona = activePersonaId ? personas[activePersonaId] : null;
    const currentModelId = modelSelect.value || defaultSettings.model;
    const modelSettings = appSettings.availableModels.find(m => m.id === currentModelId);

    const globalDialogReminder = applyUserPlaceholder(applyCharPlaceholder(
    (modelSettings && modelSettings.reminder) ? modelSettings.reminder.trim() : '',
    charNameForAI
), persona);
const globalNarratorReminder = applyUserPlaceholder(applyCharPlaceholder(
    (modelSettings && modelSettings.narratorReminder) ? modelSettings.narratorReminder.trim() : '',
    charNameForAI
), persona);
let characterDialogReminder = applyUserPlaceholder((speakerCharacter.reminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
let characterNarratorReminder = applyUserPlaceholder((speakerCharacter.narratorReminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
    const combinedDialogReminder = [globalDialogReminder, characterDialogReminder].filter(Boolean).join('\n');
    const combinedNarratorReminder = [globalNarratorReminder, characterNarratorReminder].filter(Boolean).join('\n');

    const historyForAPIcall = historyCopy.map(msg => {
    const activePersona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
    if (msg.sender === 'ai') {
        const speaker = characters[msg.speakerId || currentCharacterId];
        const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
        let processedText = applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName);
        processedText = applyUserPlaceholder(processedText, activePersona);
        return { sender: 'ai', main: `${speakerName}: ${processedText}` };
    } else { 
        const userName = activePersona?.name || 'User';
        let processedText = applyUserPlaceholder(msg.main, activePersona);
        return { sender: 'user', main: `${userName}: ${processedText}` };
    }
});

    const characterForAPI = { ...speakerCharacter };
    let fullSystemPrompt = '';
    if (modelSettings && modelSettings.instructions && modelSettings.instructions.trim() !== '') {
        fullSystemPrompt += `--- GLOBAL AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(modelSettings.instructions.trim(), charNameForAI), persona)}\n\n`;
    }
    if (persona) {
        fullSystemPrompt += `--- EXACT USER PERSONA ---\nName: ${persona.name}\nDescription: ${applyUserPlaceholder(applyCharPlaceholder(persona.description, charNameForAI), persona)}\n---\n\n`;
    }
    if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
    if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${characterForAPI.description.trim()}\n\n`;
    if (characterForAPI.lore) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${characterForAPI.lore.trim()}\n\n`;
    const chatMemoriesText = (chat.memories || '').trim();
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${chatMemoriesText}\n\n`;
    }
    characterForAPI.description = fullSystemPrompt;

    const MAX_RETRIES = 90;
    currentStreamController = new AbortController();
    let fullReply = '';
    let reasoningBuf = '';
const startTime = Date.now();
const coldStartTimer = setTimeout(() => {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate) {
        messageToUpdate.variations[message.activeVariant].main = originalText + " " + "Connecting to AI Model - Please wait or regenerate the message.";
        updateSingleMessageView(messageId);
    }
}, 20000);
const serverHungTimer = setTimeout(() => {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate && messageToUpdate.variations[message.activeVariant].main.includes("Connecting to AI Model")) {
        messageToUpdate.variations[message.activeVariant].main = originalText + " " + "The AI provider may be experiencing issues - Please wait a moment or try again later.";
        updateSingleMessageView(messageId);
    }
}, 70000);

const clearStreamTimers = () => {
    clearTimeout(coldStartTimer);
    clearTimeout(serverHungTimer);
};
    chatWindow._autoScroll = true;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (!currentStreamController) { streamAbortedByUser = true; break; }
        try {
            console.log(`Continue request (Attempt ${attempt}/${MAX_RETRIES})...`);

            const currentModel = modelSelect.value;
            const currentTemperature = temperatureSlider.value;
            const apiKeyToSend = (modelSettings && modelSettings.apiKey) || appSettings.apiKey;
const targetApiUrlToSend = (modelSettings && modelSettings.targetApiUrl) || DEFAULT_API_URL;
const isLocal = targetApiUrlToSend && (
    targetApiUrlToSend.includes('localhost') ||
    targetApiUrlToSend.includes('127.0.0.1')
);

const reminderContent = messageType === 'dialog' ? combinedDialogReminder : combinedNarratorReminder;
const lastUserContent = (isLocal && reminderContent)
    ? `${messageForAPI}\n[${reminderContent}]`
    : messageForAPI;
const messages = [
    { role: 'system', content: characterForAPI.description },
    ...historyForAPIcall.map(h => ({ role: h.sender === 'ai' ? 'assistant' : 'user', content: h.main })),
    { role: 'user', content: lastUserContent },
    ...(!isLocal && reminderContent ? [{ role: 'user', content: `[${reminderContent}]` }] : [])
];
const fetchUrl = targetApiUrlToSend;
const fetchBody = JSON.stringify({
    model: currentModelId,
    messages,
    temperature: parseFloat(currentTemperature),
    stream: true,
    options: {
        num_ctx: 32768
    }
});
const response = await fetch(fetchUrl, {
    method: 'POST',
    headers: isLocal
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeyToSend}` },
    signal: currentStreamController.signal,
    body: fetchBody
});
            clearStreamTimers();

            if (response.status === 429) {
    const waitTime = Math.min(1 * attempt, 1);
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > 20000) {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate) {
        messageToUpdate.variations[message.activeVariant].main = originalText + " " + `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
        updateSingleMessageView(messageId);
    }
    }
    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
    if (attempt === MAX_RETRIES) throw new Error("AI Model did not respond after multiple retries. Please try again later or choose another Model.");
    continue;
}
            if (!response.ok) throw new Error(await response.text());

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = '';
            fullReply = '';
            reasoningBuf = '';
            let thinkOpened = false;
            const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
            const mainTypewriter = createTypewriter();
            const thinkTypewriter = createTypewriter();
            mainTypewriter.init(sanitizeModelOutput(originalText || ''));

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';
                const currentMessageElement = document.querySelector(`[data-message-id="${messageId}"]`);
                mainContentEl = currentMessageElement ? currentMessageElement.querySelector('.main-content') : null;
                thinkBlockEl = currentMessageElement ? currentMessageElement.querySelector('.think-block') : null;
                thinkContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
                const ensureThinkBlockPresent = () => {
                    if (!currentMessageElement) return false;
                    if (!thinkBlockEl || !thinkContentEl) {
                        const refs = ensureThinkBlockElements(currentMessageElement);
                        thinkBlockEl = refs.thinkBlock;
                        thinkContentEl = refs.thinkContent;
                    }
                    return !!(thinkBlockEl && thinkContentEl);
                };
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line.startsWith('data:')) continue;
                    const dataContent = line.slice(5).trim();
                    if (dataContent === '[DONE]') { sseBuffer = ''; break; }
                    
                    try {
                        const parsed = JSON.parse(dataContent);
                        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;

                        if (isFirstChunk && (delta?.content || delta?.reasoning)) {
                            message.isStreaming = false;
                            message.streamingVariant = null;
                            if (mainContentEl) setBubbleLoading(mainContentEl, false);
                            isFirstChunk = false;
                        }

                        if (delta?.content) {
                            fullReply += delta.content;

                            const openIdx = fullReply.search(/<think>/i);
                            const closeIdx = fullReply.toLowerCase().indexOf("</think>");

                            let mainOnly;
                            let streamThinkText = null;
                            let streamThinkComplete = false;

                            if (openIdx === -1 && closeIdx !== -1) {
                                mainOnly = fullReply.slice(closeIdx + "</think>".length).trimStart();
                                streamThinkText = fullReply.slice(0, closeIdx).trim();
                                streamThinkComplete = true;
                            } else if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
                                mainOnly = (fullReply.slice(0, openIdx) + fullReply.slice(closeIdx + "</think>".length)).trim();
                                streamThinkText = fullReply.slice(openIdx + "<think>".length, closeIdx).trim();
                                streamThinkComplete = true;
                            } else if (openIdx !== -1) {
                                mainOnly = fullReply.slice(0, openIdx).trim();
                                streamThinkText = fullReply.slice(openIdx + "<think>".length).trim();
                                streamThinkComplete = false;
                            } else {
                                mainOnly = fullReply.trim();
                            }

                            const combinedTextRaw = (originalText ? `${originalText} ${mainOnly}` : mainOnly).trim();
                            const sanitizedCombined = sanitizeModelOutput(combinedTextRaw);
                            mainTypewriter.update(sanitizedCombined, t => { if (mainContentEl) { mainContentEl.innerHTML = formatSubString(t); if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
                            activeVariant.main = sanitizedCombined;

                            if (thinkEnabled && streamThinkText !== null && reasoningBuf === '' && ensureThinkBlockPresent()) {
                                thinkBlockEl.classList.remove('hidden');
                                if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                                const sanitizedThink = sanitizeModelOutput(streamThinkText);
                                thinkTypewriter.update(sanitizedThink, t => { if (thinkContentEl) thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                                if (streamThinkComplete) {
                                    activeVariant.think = sanitizedThink;
                                }
                            }
                        }
                        if (delta?.reasoning) {
                           reasoningBuf += delta.reasoning;
                           if (thinkEnabled && ensureThinkBlockPresent()) {
                               const sanitizedReasoning = sanitizeModelOutput(reasoningBuf.trim());
                               thinkBlockEl.classList.remove('hidden');
                               if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                               thinkTypewriter.update(sanitizedReasoning, t => { if (thinkContentEl) thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                               activeVariant.think = sanitizedReasoning;
                           }
                        }
                    } catch { continue; }
                }
            }

            const hasAnyReplyText = fullReply.trim() !== '' || reasoningBuf.trim() !== '';
            if (hasAnyReplyText) {
                console.log(`Successful response after ${attempt} attempts.`);
                const finalThinkMatch = fullReply.match(thinkRegex);
                const mainOnly = fullReply.replace(thinkRegex, '').trim();
                const combinedFinalRaw = (originalText ? `${originalText} ${mainOnly}` : mainOnly).trim();
                const reasoningMainFallback = extractMainFromReasoning(reasoningBuf);
                activeVariant.main = sanitizeModelOutput(combinedFinalRaw); 
                
                let finalThink = null;
                if (reasoningBuf.trim()) {
                    finalThink = sanitizeModelOutput(reasoningBuf.trim());
                } else if (finalThinkMatch) {
                    finalThink = sanitizeModelOutput(finalThinkMatch[1].trim());
                }
                
if (!finalThink) {
  const hasOpen = /<think>/i.test(fullReply);
  const closeIdx = fullReply.toLowerCase().indexOf("</think>");
  if (!hasOpen && closeIdx !== -1) {
    finalThink = sanitizeModelOutput(fullReply.slice(0, closeIdx).trim());
    const mainTail = fullReply.slice(closeIdx + "</think>".length).trimStart();
    const combinedTail = (originalText ? `${originalText} ${mainTail}` : mainTail).trim();
    activeVariant.main = sanitizeModelOutput(combinedTail);
  }
}

                if (!finalThink && reasoningBuf.trim()) {
                    finalThink = sanitizeModelOutput(reasoningBuf.trim());
                }
                if (!finalThink) {
  const hasOpen = /<think>/i.test(fullReply);
  const cIdx = fullReply.toLowerCase().indexOf("</think>");
  if (!hasOpen && cIdx !== -1) {
    finalThink = sanitizeModelOutput(fullReply.slice(0, cIdx).trim());
    const mainTail = fullReply.slice(cIdx + "</think>".length).trimStart();
    const combinedTail = (originalText ? `${originalText} ${mainTail}` : mainTail).trim();
    activeVariant.main = sanitizeModelOutput(combinedTail);
  }
}
                if ((!mainOnly || mainOnly.trim() === '') && reasoningMainFallback) {
                    const combinedFallback = (originalText ? `${originalText} ${reasoningMainFallback}` : reasoningMainFallback).trim();
                    activeVariant.main = sanitizeModelOutput(combinedFallback);
                }

                if (!thinkEnabled) { finalThink = null; }
                activeVariant.think = finalThink;

                if (finalThink && (!thinkBlockEl || !thinkContentEl)) {
                    const refs = ensureThinkBlockElements(messageElement);
                    thinkBlockEl = refs.thinkBlock;
                    thinkContentEl = refs.thinkContent;
                }

                if (thinkBlockEl) {
                    if (finalThink) {
                        thinkBlockEl.classList.remove('hidden');
                        if (thinkContentEl) {
                            thinkTypewriter.flush(finalThink, t => { thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; });
                        }
                        thinkBlockEl.open = false;
                    } else {
                        thinkBlockEl.classList.add('hidden');
                        thinkBlockEl.open = false;
                    }
                }
                playNotificationSound();
                updateTokenCount();
                break; 
            } else {
                if (attempt < MAX_RETRIES) await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            clearStreamTimers();
            if (error.name === 'AbortError') {
                console.log('Fetch aborted (Continue).');
                break;
    }
    console.error(`Error during continue (Attempt ${attempt}):`, error.message);
    const isTemporaryError = (error.message && error.message.includes('maximum capacity')) || (error.message && error.message.includes('Failed to fetch'));
    if (isTemporaryError && attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
        let errorMsg = `AI Model did not respond to the request. Please try the following steps:

• Re-enter your default API key (or model-specific API key) in the app settings by copy & paste to ensure that it's correct.
• Check the request limits per minute/per day of the provider you're using, especially in free plans. Connection fails when limits are exceeded.
• Try sending a message again later in case the model is overloaded. Also, use other AI models to see if the AI model itself was the problem.
• In some cases your API provider might have a temporary problem. Try another provider/API key to see if your provider was the problem.
• Check the FAQ section (help button on main screen) for further details to this error.`;
        if (error.message.includes('Failed to fetch')) {
            errorMsg = "Could not connect to the AI provider. Please check your API key and internet connection, then try again.";
        }
        if(mainContentEl) {
            const sanitizedError = sanitizeModelOutput(`${originalText}\n\n[--- ERROR: ${errorMsg} ---]`);
            mainContentEl.innerHTML = formatSubString(sanitizedError);
        }
        break;
    }
}
    }

    message.isStreaming = false;
    message.streamingVariant = null;
    setBubbleLoading(mainContentEl, false);
    loadingIndicator.classList.add('hidden');
    stopStreamBtn.classList.add('hidden');
    dialogBtn.disabled = false;
    storyBtn.disabled = false;
    currentStreamController = null;
    await saveSingleCharacterToDB(characters[currentCharacterId]);
    updateSingleMessageView(messageId);

    const finalMessageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (finalMessageElement) {
        const regenBtn = finalMessageElement.querySelector('.regenerate-btn');
        const continueBtn = finalMessageElement.querySelector('.continue-btn');
        if (regenBtn) {
            regenBtn.disabled = false;
            regenBtn.classList.remove('is-loading');
        }
        if (continueBtn) {
            continueBtn.disabled = false;
            continueBtn.classList.remove('is-loading');
        }
        const finalControls = finalMessageElement.querySelector('.message-controls');
        if (finalControls) finalControls.classList.remove('is-streaming');

        const prevBtn = finalMessageElement.querySelector('.prev-variant-btn');
        const nextBtn = finalMessageElement.querySelector('.next-variant-btn');
        const counter = finalMessageElement.querySelector('.variant-counter');

        if (prevBtn) prevBtn.style.display = '';
        if (nextBtn) nextBtn.style.display = '';
        if (counter) counter.style.display = '';
    }
}



function updateSingleMessageView(messageId) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat) return;

    const message = chat.history.find(m => m.id === messageId);
    if (!message) return;

    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    let mainContentEl = messageElement?.querySelector('.main-content');
    let thinkBlockEl = messageElement?.querySelector('.think-block');
    let thinkContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
    if (!messageElement) return;

    const mainContent = messageElement.querySelector('.main-content');
    const thinkBlock = messageElement.querySelector('.think-block');
    const controls = messageElement.querySelector('.message-controls');

    const activeVariant = message.variations[message.activeVariant];
    const shouldShowLoader = message.sender === 'ai'
        && message.isStreaming
        && message.streamingVariant === message.activeVariant
        && activeVariant.main === '...';

    if (mainContent) {
        if (shouldShowLoader) {
            setBubbleLoading(mainContent, true);
        } else {
            setBubbleLoading(mainContent, false);
            const sanitizedMain = sanitizeModelOutput(activeVariant.main);
            if (sanitizedMain !== activeVariant.main) {
                activeVariant.main = sanitizedMain;
            }
            mainContent.innerHTML = formatSubString(sanitizedMain);
        }
    }

    if (thinkBlock) {
        if (activeVariant.think) {
            const sanitizedThink = sanitizeModelOutput(activeVariant.think);
            if (sanitizedThink !== activeVariant.think) {
                activeVariant.think = sanitizedThink;
            }
            const thinkContent = thinkBlock.querySelector('.think-block-content');
            thinkContent.innerHTML = `&lt;think&gt;<br>${formatSubString(sanitizedThink)}<br>&lt;/think&gt;`;
            thinkBlock.classList.remove('hidden');
        } else {
            thinkBlock.classList.add('hidden');
        }
    }

    if (controls) {
        const prevBtn = controls.querySelector('.prev-variant-btn');
        const nextBtn = controls.querySelector('.next-variant-btn');
        const counter = controls.querySelector('.variant-counter');

        if (prevBtn) prevBtn.disabled = message.activeVariant === 0;
        if (nextBtn) nextBtn.disabled = message.activeVariant >= message.variations.length - 1;
        if (counter) counter.textContent = `${message.activeVariant + 1}/${message.variations.length}`;
    }
}



    function closeEditor() {
    document.getElementById('card-name').style.height = 'auto';
    tempUploadedImages = {};
    characterEditorModalContent.scrollTop = 0; 
    characterEditorModal.classList.add('hidden'); 
}



    function openEditorForNew() {
    tempUploadedImages = {};
    characterForm.reset();
    const textareas = characterForm.querySelectorAll('textarea');
    textareas.forEach(ta => {
        ta.style.height = 'auto';
        ta.style.overflowY = 'hidden';
    });
    document.getElementById('scenario-editor-list').innerHTML = '';
    createScenarioInput({ name: 'Main Greeting', text: '' });
    editingCharField.value = '';
    document.getElementById('chat-list-screen').style.backgroundImage = 'none';
    editorAvatarImg.src = '';
    editorAvatarImg.classList.add('hidden');
    editorAvatarPlaceholder.classList.remove('hidden');

    const editorAvatarContainer = editorAvatarImg.parentElement;
    editorAvatarContainer.classList.remove('effect-container');
    editorAvatarContainer.style.backgroundImage = 'none';

    characterEditorModal.classList.remove('hidden');
    updateEditorTokenCount();
}




  function openEditorForEdit() {
  if (!currentCharacterId) return;
  const character = characters[currentCharacterId];
  if (!character) return; 
  const textareas = characterForm.querySelectorAll('textarea');
    textareas.forEach(ta => {
    ta.style.height = 'auto';
    ta.style.overflowY = 'hidden';
});

  characterForm.reset();

  const avatarUrl = getImageUrl(character.avatar);
  const backgroundUrl = getImageUrl(character.background);
  const editorAvatarContainer = editorAvatarImg.parentElement; 

if (avatarUrl) {
    editorAvatarImg.src = avatarUrl;
    smartObjectFit(editorAvatarImg);
    editorAvatarImg.classList.remove('hidden');
    editorAvatarPlaceholder.classList.add('hidden');
    editorAvatarContainer.classList.add('effect-container');
    editorAvatarContainer.style.backgroundImage = `url('${avatarUrl}')`;
} else {
    editorAvatarImg.src = '';
    editorAvatarImg.classList.add('hidden');
    editorAvatarPlaceholder.classList.remove('hidden');
    editorAvatarContainer.classList.remove('effect-container');
    editorAvatarContainer.style.backgroundImage = 'none';
}

  document.getElementById('card-name').value = character.name || '';
  document.getElementById('chat-name').value = character.chatName || character.name || '';
  document.getElementById('char-avatar').value = avatarUrl;
  document.getElementById('char-background').value = backgroundUrl;
  document.getElementById('chat-list-screen').style.backgroundImage = backgroundUrl ? `url('${backgroundUrl}')` : 'none';
  charInstructionsInput.value = character.instructions || '';
  charDescriptionInput.value = character.description || '';
  charLoreInput.value = character.lore || '';
  document.getElementById('char-tags').value = character.tags || '';
  document.getElementById('char-reminder').value = character.reminder || '';
  document.getElementById('char-narrator-reminder').value = character.narratorReminder || '';
  
  const scenarioListDiv = document.getElementById('scenario-editor-list');
  scenarioListDiv.innerHTML = '';
  if (character.scenarios && character.scenarios.length > 0 && typeof character.scenarios[0] === 'string') {
      character.scenarios = character.scenarios.map((text, index) => ({ name: `Scenario ${index + 1}`, text }));
  }
  if (character.scenarios && character.scenarios.length > 0) {
      character.scenarios.forEach(createScenarioInput);
  } else {
      createScenarioInput({ name: '', text: '' });
  }
  
  editingCharField.value = currentCharacterId;
  updateEditorTokenCount();
  
  characterEditorModal.classList.remove('hidden');

  setTimeout(() => {
    const textareasToResize = [
      'card-name', 'char-instructions', 'char-description', 'char-lore',
      'char-reminder', 'char-narrator-reminder'
    ];
    textareasToResize.forEach(id => {
      const textarea = document.getElementById(id);
      if (textarea) autoResizeTextarea({ target: textarea });
    });
  }, 0);
}



async function handleCopyCharacter() {
    if (!currentCharacterId) return;

    const originalCharacter = characters[currentCharacterId];
    if (!originalCharacter) return;

    if (await showCustomConfirm(`Do you really want to copy the character "${originalCharacter.name}"?`)) {

        const newCharacter = JSON.parse(JSON.stringify(originalCharacter));

        newCharacter.id = 'char-' + Date.now();
        newCharacter.name = originalCharacter.name + " (Copy)";
        newCharacter.chats = {};

        characters[newCharacter.id] = newCharacter;

        await saveSingleCharacterToDB(newCharacter);
        renderCharacterList();
        showCustomAlert(`Character "${originalCharacter.name}" was successfully copied!`);
        showMainScreen();
    }
}



// --- FUNCTIONS FOR GROUP CHATS ---

function renderParticipantIcons() {
    participantIconList.innerHTML = '';
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat || !chat.participants || chat.participants.length <= 1) return;
    const guestIds = chat.participants.slice(1);

    guestIds.forEach(charId => {
        const participant = characters[charId];
        if (!participant) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'participant-icon-wrapper';
        wrapper.dataset.charId = charId;

        if (participant.avatar) {
            const img = document.createElement('img');
            img.onerror = function() {
                const placeholder = document.createElement('div');
                placeholder.className = 'placeholder-icon';
                placeholder.innerHTML = '👤';
                this.replaceWith(placeholder);
            };
            img.src = participant.avatar;
            smartObjectFit(img);
            img.style.objectFit = 'cover';
            img.style.objectPosition = 'center';
            wrapper.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'placeholder-icon';
            placeholder.innerHTML = '👤';
            wrapper.appendChild(placeholder);
        }

        participantIconList.appendChild(wrapper);
    });

    const hint = document.createElement('span');
    hint.className = 'participant-remove-hint';
    hint.innerHTML = '&times;';
    participantIconList.appendChild(hint);
}



// --- GROUP CHAT CHARACTER DROPDOWN ---

function showGroupCharDropdown() {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat || !chat.participants || chat.participants.length <= 1) {
        hideGroupCharDropdown();
        return;
    }

    groupCharDropdown.innerHTML = '';
    const guestIds = chat.participants.filter(id => id !== currentCharacterId);
    if (guestIds.length === 0) {
        hideGroupCharDropdown();
        return;
    }

    guestIds.forEach(charId => {
        const character = characters[charId];
        if (!character) return;
        const displayName = (character.chatName || character.name || '').trim();
        if (!displayName) return;

        const item = document.createElement('div');
        item.className = 'group-char-dropdown-item';
        if (charId === activeGroupParticipantId) item.classList.add('is-selected');
        item.dataset.charId = charId;

        let avatarEl;
        if (character.avatar) {
            avatarEl = document.createElement('img');
            avatarEl.src = getImageUrl(character.avatar);
            avatarEl.className = 'group-char-dropdown-avatar';
            avatarEl.alt = displayName;
            avatarEl.onerror = function() {
                const ph = document.createElement('div');
                ph.className = 'group-char-dropdown-avatar-placeholder';
                ph.textContent = '👤';
                this.replaceWith(ph);
            };
        } else {
            avatarEl = document.createElement('div');
            avatarEl.className = 'group-char-dropdown-avatar-placeholder';
            avatarEl.textContent = '👤';
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'group-char-dropdown-name';
        nameEl.textContent = displayName;

        item.appendChild(avatarEl);
        item.appendChild(nameEl);
        groupCharDropdown.appendChild(item);
    });

    if (groupCharDropdown.childElementCount > 0) {
        groupCharDropdown.classList.remove('hidden');
    } else {
        hideGroupCharDropdown();
    }
}

function hideGroupCharDropdown() {
    groupCharDropdown.classList.add('hidden');
}

function setActiveGroupParticipant(charId) {
    activeGroupParticipantId = charId;
    const character = characters[charId];
    const displayName = character ? (character.chatName || character.name || '').trim() : '';
    groupCharBubbleName.textContent = displayName;
    groupCharBubble.classList.remove('hidden');
    hideGroupCharDropdown();
    messageInput.focus();
}

function clearActiveGroupParticipant() {
    activeGroupParticipantId = null;
    groupCharBubble.classList.add('hidden');
    groupCharBubbleName.textContent = '';
}



function openParticipantModal(searchTerm = '') {
  participantSelectionList.innerHTML = '';
  const currentParticipants = characters[currentCharacterId]?.chats?.[currentChatId]?.participants || [];

  const sortedCharacters = Object.values(characters).sort((a, b) => {
    return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
  });

  const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();
  const filteredCharacters = sortedCharacters.filter(char => 
    char.name.toLowerCase().includes(lowerCaseSearchTerm)
  );

  filteredCharacters.forEach(char => {
    if (!currentParticipants.includes(char.id)) {
      const btn = document.createElement('button');
      btn.className = 'participant-option-btn';
      btn.dataset.charId = char.id;

      const imageUrl = getImageUrl(char.avatar);
const avatarHtml = `
    <img src="${imageUrl}" class="${char.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
    <div class="placeholder-icon ${char.avatar ? 'hidden' : ''}">👤</div>
`;

      btn.innerHTML = `${avatarHtml} <span>${char.name}</span>`;

      participantSelectionList.appendChild(btn);
    }
  });
smartObjectFitAll('.participant-option-btn img');
  participantSelectionModal.classList.remove('hidden');
  document.querySelectorAll('#participant-selection-list img').forEach(img => {
  img.style.objectFit = 'cover';
  img.style.objectPosition = 'center';
});
}



async function addParticipantToChat(participantId) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat || chat.participants.includes(participantId)) return;

    chat.participants.push(participantId);
    await saveSingleCharacterToDB(characters[currentCharacterId]);
    updateTokenCount();
    renderParticipantIcons(); 
    participantSelectionModal.classList.add('hidden');
}



// --- FUNCTIONS FOR PERSONA MANAGEMENT ---

function openPersonaListModal(searchTerm = '') {
  const personaListContainer = document.getElementById('persona-list-container');
  personaListContainer.innerHTML = '';
  const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();

  const filteredPersonas = Object.values(personas).filter(persona =>
    persona.name.toLowerCase().includes(lowerCaseSearchTerm)
  );

  if (filteredPersonas.length === 0) {
    const message = Object.keys(personas).length === 0 ?
      'No Personas created yet.' :
      'No Personas found.';
    personaListContainer.innerHTML = `<p>${message}</p>`;
  } else {
    const sortedPersonas = filteredPersonas.sort((a,b) => a.name.localeCompare(b.name));
    sortedPersonas.forEach(persona => {
      const personaEl = document.createElement('div');
      personaEl.className = 'persona-list-entry';
      personaEl.dataset.personaId = persona.id;

      const imageUrl = getImageUrl(persona.avatar);
const avatarHtml = `
    <img src="${imageUrl}" class="${persona.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
    <div class="placeholder-icon ${persona.avatar ? 'hidden' : ''}">👤</div>
`;
      const nameHtml = `<span style="flex-grow: 1;">${persona.name}</span>`;
      const buttonsHtml = `
        <button class="edit-persona-btn" title="Edit Persona"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="delete-persona-btn" title="Delete Persona"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      `;

      personaEl.innerHTML = avatarHtml + nameHtml + buttonsHtml;
      personaListContainer.appendChild(personaEl);
    });
  }
  smartObjectFitAll('.persona-list-entry img');
  personaListModal.classList.remove('hidden');
}



function openPersonaEditor(personaId = null) {
  personaForm.reset();
  const descTextarea = document.getElementById('persona-description');
  descTextarea.style.height = 'auto';
  descTextarea.style.overflowY = 'hidden';
  const editorHeader = personaEditorModal.querySelector('h2');
  const editingPersonaIdField = document.getElementById('editing-persona-id');

  tempUploadedImages.personaAvatar = null;
  editingPersonaIdField.value = personaId;

  if (personaId) {
    editorHeader.textContent = 'Edit Persona';
    const persona = personas[personaId];

    if (persona) {
      document.getElementById('persona-name').value = persona.name || '';
      document.getElementById('persona-avatar').value = getImageUrl(persona.avatar || '');
      personaAvatarInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('persona-description').value = persona.description || '';

      const avatarUrl = getImageUrl(persona.avatar || '');
      personaEditorAvatarImg.src = avatarUrl;
      smartObjectFit(personaEditorAvatarImg);
      personaEditorAvatarPlaceholder.classList.toggle('hidden', !!avatarUrl);
      personaEditorAvatarImg.classList.toggle('hidden', !avatarUrl);
    } else {
      showCustomAlert('Error: Persona with ID ' + personaId + ' could not be found.');
      return;
    }
  } else {
    editorHeader.textContent = 'Create new Persona';
    personaEditorAvatarPlaceholder.classList.remove('hidden');
    personaEditorAvatarImg.classList.add('hidden');

    const container = document.getElementById('persona-editor-avatar-container');
    container.classList.remove('effect-container');
    container.style.backgroundImage = 'none';
  }

  personaListModal.classList.add('hidden');
  personaEditorModal.classList.remove('hidden');
  updatePersonaEditorTokenCount();

  if (descTextarea) {
    setTimeout(() => autoResizeTextarea({ target: descTextarea }), 0);
  }
}



async function handlePersonaFormSubmit(event) {
    event.preventDefault();
    const personaIdToEdit = document.getElementById('editing-persona-id').value;
    const avatarValue = document.getElementById('persona-avatar').value;

    let finalAvatar = avatarValue;
    if (tempUploadedImages.personaAvatar) {
        finalAvatar = tempUploadedImages.personaAvatar;
    }

    const personaData = {
        name: document.getElementById('persona-name').value,
        avatar: finalAvatar,
        description: document.getElementById('persona-description').value
    };

    if (personaIdToEdit) {
        personas[personaIdToEdit] = {
            ...personas[personaIdToEdit],
            ...personaData
        };
    } else {
        const newId = 'persona-' + Date.now();
        personas[newId] = { id: newId, ...personaData };
    }
    await savePersonasToDB();
    personaEditorModal.classList.add('hidden');
    openPersonaListModal();
}



async function handleDeletePersona(personaId) {
    const personaName = personas[personaId]?.name || 'this Persona';
    if (await showCustomConfirm(`Are you sure you really want to delete the persona "${personaName}"?`, true)) {
        delete personas[personaId];
        await savePersonasToDB();
        openPersonaListModal(); 
    }
}



// 2. EVENT LISTENERS

managePersonasBtn.addEventListener('click', () => {
  personaListSearchInput.value = ''; 
  openPersonaListModal(); 
});

personaListSearchInput.addEventListener('input', () => {
  openPersonaListModal(personaListSearchInput.value);
});

closePersonaListBtn.addEventListener('click', () => {
    personaListModal.classList.add('hidden');
});

createNewPersonaBtn.addEventListener('click', () => {
    openPersonaEditor(); 
});

cancelPersonaEditBtn.addEventListener('click', () => {
    personaEditorModal.classList.add('hidden');
    openPersonaListModal(); 
});

personaForm.addEventListener('submit', handlePersonaFormSubmit);

document.getElementById('persona-list-container').addEventListener('click', (event) => {
    const personaElement = event.target.closest('.persona-list-entry'); 
    if (!personaElement) return;

    const personaId = personaElement.dataset.personaId;

    if (event.target.closest('.edit-persona-btn')) {
        openPersonaEditor(personaId);
    }

    if (event.target.closest('.delete-persona-btn')) {
        handleDeletePersona(personaId);
    }
});



// --- FUNCTIONS FOR PERSONA SELECTION IN CHAT ---

function openPersonaSelectionModal(searchTerm = '') {
  try {
    const personaSelectionList = document.getElementById('persona-selection-list');
    if (!personaSelectionList) {
      console.error("CRITICAL ERROR: The container 'persona-selection-list' was not found in the HTML!");
      return;
    }

    personaSelectionList.innerHTML = '';
    const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();

    const filteredPersonas = Object.values(personas).filter(persona =>
      persona.name.toLowerCase().includes(lowerCaseSearchTerm)
    );

    if (filteredPersonas.length === 0) {
      const message = Object.keys(personas).length === 0 ?
        'You have not created any personas yet. Please create one in the main menu.' :
        'No personas found.';
      personaSelectionList.innerHTML = `<p>${message}</p>`;
    } else {
      const sortedPersonas = filteredPersonas.sort((a, b) => a.name.localeCompare(b.name));

      sortedPersonas.forEach((persona) => {
        const btn = document.createElement('button');
        btn.className = 'participant-option-btn';
        btn.dataset.personaId = persona.id;

        const imageUrl = getImageUrl(persona.avatar);
const avatarHtml = `
    <img src="${imageUrl}" class="${persona.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
    <div class="placeholder-icon ${persona.avatar ? 'hidden' : ''}">👤</div>
`;

        const nameSpan = document.createElement('span');
        nameSpan.textContent = persona.name;
        btn.innerHTML = avatarHtml;
        btn.appendChild(nameSpan);

        personaSelectionList.appendChild(btn);
      });
    }

    const personaSelectionModal = document.getElementById('persona-selection-modal');
    if (!personaSelectionModal) {
      console.error("CRITICAL ERROR: The modal 'persona-selection-modal' was not found in the HTML!");
      return;
    }
    personaSelectionModal.classList.remove('hidden');
    document.querySelectorAll('#persona-selection-list img').forEach(img => {
  img.style.objectFit = 'cover';
  img.style.objectPosition = 'center';
});

  } catch (e) {
    console.error("An unexpected ERROR has occurred in 'openPersonaSelectionModal':", e);
    showCustomAlert("A JavaScript error has occurred. Please check the console (F12).");
  }
}

async function setActivePersonaForChat(personaId) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (!chat) return;

    const personaName = personas[personaId]?.name || 'this Persona';
    if (await showCustomConfirm(`Do you want to set "${personaName}" as your persona for this chat?\n\n(You can unselect persona anytime.)`)) {
        chat.activePersonaId = personaId;
        await saveSingleCharacterToDB(characters[currentCharacterId]);
        updateTokenCount();
        personaSelectionModal.classList.add('hidden');
        startChat(currentCharacterId, currentChatId); 
    }
}



    async function handleFormSubmit(event) {
  event.preventDefault();
  const charIdToEdit = editingCharField.value;
  
  const cardName = document.getElementById('card-name').value;
  const chatName = document.getElementById('chat-name').value;
  const avatarValue = document.getElementById('char-avatar').value;
  const backgroundValue = document.getElementById('char-background').value;

    let finalAvatar = avatarValue;
    let finalBackground = backgroundValue;

    if (tempUploadedImages.avatar) {
        finalAvatar = tempUploadedImages.avatar;
    }
    if (tempUploadedImages.background) {
        finalBackground = tempUploadedImages.background;
    } else {
    if (avatarValue.startsWith('blob:')) {
      finalAvatar = tempUploadedImages.avatar;
    }
    if (backgroundValue.startsWith('blob:')) {
      finalBackground = tempUploadedImages.background;
    }
  }

  const instructions = charInstructionsInput.value;
  const description = charDescriptionInput.value;
  const lore = charLoreInput.value;
  const tags = document.getElementById('char-tags').value;
  const reminder = document.getElementById('char-reminder').value;
  const narratorReminder = document.getElementById('char-narrator-reminder').value;
  const scenarioEntries = document.querySelectorAll('.scenario-entry');
  const scenarios = [];
  scenarioEntries.forEach(entry => {
    const nameInput = entry.querySelector('.scenario-name-input');
    const textInput = entry.querySelector('textarea');
    if (textInput.value.trim() !== "") {
      scenarios.push({
        name: nameInput.value.trim() || 'Unnamed Scenario',
        text: textInput.value
      });
    }
  });
    closeEditor();

  if (charIdToEdit) {
    const character = characters[charIdToEdit];
    character.name = cardName; 
    character.chatName = chatName;
    character.avatar = finalAvatar;
    character.background = finalBackground;
    character.instructions = instructions;
    character.description = description;
    character.lore = lore;
    character.tags = tags;
    character.reminder = reminder;
    character.narratorReminder = narratorReminder;
    character.scenarios = scenarios;
    await saveSingleCharacterToDB(character);
  } else {
    const newCharacter = {
      id: 'char-' + Date.now(),
      name: cardName,
      chatName: chatName,
      avatar: finalAvatar,
      background: finalBackground,
      instructions: instructions,
      description: description,
      lore: lore,
      tags: tags,
      reminder: reminder,
      narratorReminder: narratorReminder,
      scenarios: scenarios,
      chats: {}
    };
    characters[newCharacter.id] = newCharacter;
    await saveSingleCharacterToDB(newCharacter);
  }
  
  renderCharacterList();
  if (currentCharacterId) {
    showChatList(currentCharacterId);
  }

}



function createScenarioInput(scenario) {
    const scenarioListDiv = document.getElementById('scenario-editor-list');
    const entryDiv = document.createElement('div');
    entryDiv.className = 'scenario-entry';
    const fieldsWrapper = document.createElement('div');
    fieldsWrapper.style.flexGrow = '1';
    const nameInput = document.createElement('input');

    nameInput.type = 'text';
    nameInput.className = 'scenario-name-input';
    nameInput.placeholder = 'Scenario title';
    nameInput.value = scenario.name || '';

    const textarea = document.createElement('textarea');
    textarea.rows = 7;
    textarea.placeholder = "Scenario description, User role, Story progression, First scene, First character message etc.";
    textarea.value = scenario.text || '';
    textarea.addEventListener('dblclick', (e) => e.target.style.height = `${e.target.scrollHeight}px`);
    textarea.addEventListener('input', autoResizeTextarea);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-scenario-btn';
    deleteBtn.title = 'Delete Scenario';
    deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

    fieldsWrapper.appendChild(nameInput);
    fieldsWrapper.appendChild(textarea);
    entryDiv.appendChild(fieldsWrapper);
    entryDiv.appendChild(deleteBtn);
    scenarioListDiv.appendChild(entryDiv);
}

document.getElementById('add-scenario-btn').addEventListener('click', () => {
    createScenarioInput(""); 
});

document.getElementById('scenario-editor-list').addEventListener('click', async (event) => {
    if (event.target.classList.contains('delete-scenario-btn')) {
        if (await showCustomConfirm("Do you really want to delete this scenario?", true)) {
            event.target.parentElement.remove();
        }
    }
});



function createModelEntry(model = {}) {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'model-entry';

    const name = model.name || '';
    const id = model.id || '';
    const targetApiUrl = model.targetApiUrl || ''; 
    const apiKey = model.apiKey || '';    
    const instructions = model.instructions || '';
    const reminder = model.reminder || '';
    const narratorReminder = model.narratorReminder || '';

    entryDiv.innerHTML = `
    <div class="model-content-wrapper">
        <div class="model-entry-inputs">
            <input type="text" class="model-name-input" placeholder="Display Name (e.g., My favorite Model)" value="${name}">
            <input type="text" class="model-id-input" placeholder="Technical Model ID (e.g., provider/model-name)" value="${id}">
            <input type="url" class="model-target-api-url-input" placeholder="Other provider URL (https://.../v1/chat/completions)" value="${targetApiUrl}">
            <input type="password" class="model-api-key-input" placeholder="Other provider API Key (sk-1a2b3c...xyz)" value="${apiKey}">
        </div>
        <details class="global-prompts-container">
            <summary class="global-prompts-summary">Global Prompts</summary>
            <div class="global-prompts-content">
                <label>AI Instructions:</label>
                <textarea class="model-instructions-input" rows="2" placeholder="General AI Instructions for this model... (e.g., 'Be creative and drive the plot forward.')">${instructions}</textarea>
                <label>Character Reminder:</label>
                <textarea class="model-reminder-input" rows="2" placeholder="Character Reminder for this model... (e.g., 'Reply only as {{char}} now.')">${reminder}</textarea>
                <label>Narrator Reminder:</label>
                <textarea class="model-narrator-reminder-input" rows="2" placeholder="Narrator Reminder for this model... (e.g., 'Reply only as an omniscient narrator now.')">${narratorReminder}</textarea>
            </div>
        </details>
    </div>
    <button type="button" class="delete-model-btn" title="Delete Model"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
    `;

    const textareas = entryDiv.querySelectorAll('.global-prompts-content textarea');
    textareas.forEach(textarea => {
        textarea.addEventListener('input', autoResizeTextarea);
    });

    const detailsContainer = entryDiv.querySelector('.global-prompts-container');
    detailsContainer.addEventListener('toggle', () => {
        if (detailsContainer.open) {
            textareas.forEach(textarea => {
                autoResizeTextarea({ target: textarea });
            });
        }
    });

    entryDiv.querySelector('.delete-model-btn').addEventListener('click', async () => {
        if (await showCustomConfirm('Are you sure you want to delete this model?', true)) {
            entryDiv.remove();
        }
    });

    modelListContainer.appendChild(entryDiv);
}



    async function saveAndCloseMessageEditor() {
        const messageId = messageEditorModal.dataset.editingMessageId;
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat || !messageId) return;

        const messageToUpdate = chat.history.find(m => m.id === messageId);
        if (!messageToUpdate) return;
        if(messageToUpdate.sender === 'ai') {
            const activeVariant = messageToUpdate.variations[messageToUpdate.activeVariant];
            activeVariant.main = messageEditorTextarea.value;
        } else {
             messageToUpdate.main = messageEditorTextarea.value;
        }
        
        const characterToSave = characters[currentCharacterId];
        await saveSingleCharacterToDB(characterToSave); 

messageEditorModal.classList.add('hidden');
        delete messageEditorModal.dataset.editingMessageId;
        
        const currentScroll = chatWindow.scrollTop;
    startChat(currentCharacterId, currentChatId);
    setTimeout(() => {
        chatWindow.scrollTop = currentScroll;
    }, 0);
    updateTokenCount();
}



function restoreLastSession() {
    const lastCharId = localStorage.getItem('activeCharacterId');
    const lastChatId = localStorage.getItem('activeChatId');

    if (lastCharId && lastChatId && characters[lastCharId] && characters[lastCharId].chats[lastChatId]) {
        startChat(lastCharId, lastChatId);
    } else if (lastCharId && characters[lastCharId]) {
        showChatList(lastCharId);
    } else {
    characterSelectionScreen.classList.remove('is-inactive');

    starsContainer.style.transition = 'none';
    starsContainer.classList.add('visible');
    setTimeout(() => {
        starsContainer.style.transition = 'opacity 0.5s ease-in-out';
    }, 10);
}
}






    // --- EVENT LISTENERS & INITIALIZATION ---
    



let currentUploadTargetId = null;
const uploadAvatarBtn = document.getElementById('upload-avatar-btn');
const uploadBgBtn = document.getElementById('upload-bg-btn');
const uploadPersonaAvatarBtn = document.getElementById('upload-persona-avatar-btn');
const imageUploader = document.getElementById('image-uploader');

uploadAvatarBtn.addEventListener('click', () => {
  currentUploadTargetId = 'char-avatar'; 
  imageUploader.click(); 
});

uploadBgBtn.addEventListener('click', () => {
  currentUploadTargetId = 'char-background'; 
  imageUploader.click(); 
});

uploadPersonaAvatarBtn.addEventListener('click', () => {
  currentUploadTargetId = 'persona-avatar';
  imageUploader.click();
});

imageUploader.addEventListener('change', async (event) => {
    if (!currentUploadTargetId) return;
    const file = event.target.files[0];
    if (!file) return;

    try {
        const { dataURL, blob, originalDataURL } = await imageFileToWebp(file, 0.80);
        const objectURL = URL.createObjectURL(blob);

        if (currentUploadTargetId === 'char-avatar') {
            tempUploadedImages.avatar = dataURL;
            tempUploadedImages.avatarOriginal = originalDataURL;
        } else if (currentUploadTargetId === 'char-background') {
            tempUploadedImages.background = dataURL;
            tempUploadedImages.backgroundOriginal = originalDataURL;
        } else if (currentUploadTargetId === 'persona-avatar') {
            tempUploadedImages.personaAvatar = dataURL;
            tempUploadedImages.personaAvatarOriginal = originalDataURL;
        }

        const targetInput = document.getElementById(currentUploadTargetId);
        if (targetInput) {
            targetInput.value = objectURL; 
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } catch (error) {
        console.error("Error converting file to Data URL:", error);
        showCustomAlert("There was an error processing the image file.");
    }

    imageUploader.value = '';
    currentUploadTargetId = null;
});



const editorFieldsToMonitor = [
  'card-name', 'char-description', 'char-lore', 'char-instructions',
  'char-reminder', 'char-narrator-reminder'
];
editorFieldsToMonitor.forEach(id => {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener('input', updateEditorTokenCount);
    if (element.tagName === 'TEXTAREA') {
      element.addEventListener('input', autoResizeTextarea);
    }
  }
});

document.getElementById('scenario-editor-list').addEventListener('input', updateEditorTokenCount);

const personaEditorFieldsToMonitor = ['persona-name', 'persona-description'];
personaEditorFieldsToMonitor.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('input', updatePersonaEditorTokenCount);
        if (element.tagName === 'TEXTAREA') {
            element.addEventListener('input', autoResizeTextarea);
        }
    }

const personaAvatarInput = document.getElementById('persona-avatar');
const personaEditorAvatarImg = document.getElementById('persona-editor-avatar-img');
const personaEditorAvatarPlaceholder = document.getElementById('persona-editor-avatar-placeholder');
personaAvatarInput.addEventListener('input', () => {
    const url = personaAvatarInput.value;
    const container = document.getElementById('persona-editor-avatar-container'); 

    if (url) {
        personaEditorAvatarImg.src = url;
        smartObjectFit(personaEditorAvatarImg);
        personaEditorAvatarImg.classList.remove('hidden');
        personaEditorAvatarPlaceholder.classList.add('hidden');
        container.classList.add('effect-container');
        container.style.backgroundImage = `url('${url}')`;
    } else {
        personaEditorAvatarImg.classList.add('hidden');
        personaEditorAvatarPlaceholder.classList.remove('hidden');
        container.classList.remove('effect-container');
        container.style.backgroundImage = 'none';
    }
});

personaEditorAvatarImg.onerror = () => {
    personaEditorAvatarImg.classList.add('hidden');
    personaEditorAvatarPlaceholder.classList.remove('hidden');
    const container = personaEditorAvatarImg.parentElement;
    container.classList.remove('effect-container');
    container.style.backgroundImage = 'none';
};
});

    document.body.addEventListener('click', () => {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }, { once: true });
    function addSettingListener(element, key, eventType = 'input') {
    const isCheckbox = element.type === 'checkbox';
    element.addEventListener(eventType, async () => {
        const value = isCheckbox ? element.checked.toString() : element.value;
        applySetting(key, value);
        await saveSettingToDB(key, value);
    });
}

    newCharacterBtn.addEventListener('click', openEditorForNew);
    editCharacterBtn.addEventListener('click', openEditorForEdit);
    copyCharacterBtn.addEventListener('click', handleCopyCharacter);
    searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.trim();
    renderCharacterList(searchTerm);
});

document.getElementById('tag-search-input').addEventListener('input', () => {
    renderCharacterList();
});



appSettingsBtn.addEventListener('click', () => {
    loadAppSettingsFromDB();
    appSettingsModal.classList.remove('hidden');
});

appSettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveAppSettings();
});

cancelAppSettingsBtn.addEventListener('click', () => {
    appSettingsModalContent.scrollTop = 0;
    appSettingsModal.classList.add('hidden');
});

addModelBtn.addEventListener('click', () => {
    createModelEntry();
});
resetAppSettingsBtn.addEventListener('click', resetAppSettings);



async function toggleArchiveState(charId) {
    const character = characters[charId];
    if (!character) return;

    character.isArchived = !character.isArchived;
    if (character.isArchived) character.isFavorite = false;

    await saveSingleCharacterToDB(character);

    const card = document.querySelector(`.character-card[data-char-id="${charId}"]`);
    if (!card) { renderCharacterList(searchInput.value.trim()); return; }

    const archiveBtn = card.querySelector('.archive-btn');
    const upIcon   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
    const downIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    const starSvg  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

    function insertCardSorted(card, name, list) {
        const existing = [...list.querySelectorAll('.character-card')];
        for (const el of existing) {
            if (name.localeCompare(characters[el.dataset.charId]?.name || '', 'de', { sensitivity: 'base' }) <= 0) {
                list.insertBefore(card, el); return;
            }
        }
        list.appendChild(card);
    }

    if (character.isArchived) {
        archiveBtn.innerHTML = upIcon;
        archiveBtn.title = 'Retrieve from the archive';
        card.querySelector('.favorite-btn')?.remove();

        // Remove from favorites bar
        const favBar = document.getElementById('favorites-bar');
        const favItem = favBar?.querySelector(`[data-char-id="${charId}"]`);
        if (favItem) {
            favItem.remove();
            if (!favBar.querySelector('.favorite-item')) {
                favBar.innerHTML = `<span class="favorites-placeholder">No Favorites selected</span>`;
            }
        }

        insertCardSorted(card, character.name, archivedCharacterList);
        archiveSection.classList.remove('hidden');
    } else {
        archiveBtn.innerHTML = downIcon;
        archiveBtn.title = 'Archive Character';

        const favBtn = document.createElement('button');
        favBtn.className = 'favorite-btn';
        favBtn.title = 'Mark as Favorite';
        favBtn.innerHTML = starSvg;
        card.insertBefore(favBtn, card.firstChild);

        insertCardSorted(card, character.name, characterList);
        if (!archivedCharacterList.querySelector('.character-card')) {
            archiveSection.classList.add('hidden');
        }
    }
}



characterList.addEventListener('click', async (event) => {
    if (event.target.classList.contains('favorite-btn')) {
        event.stopPropagation();
        const card = event.target.closest('.character-card');
        const charId = card.dataset.charId;
        const character = characters[charId];
        if (character) {
            character.isFavorite = !character.isFavorite;
            await saveSingleCharacterToDB(character);

            const favBtn = card.querySelector('.favorite-btn');
            const favBar = document.getElementById('favorites-bar');

            if (character.isFavorite) {
                favBtn.classList.add('is-favorite');

                favBar.querySelector('.favorites-placeholder')?.remove();

                const imageUrl = getImageUrl(character.avatar);
                const favElement = document.createElement('div');
                favElement.className = 'favorite-item';
                favElement.dataset.charId = charId;
                favElement.innerHTML = `
                  <div class="avatar-container">
                    <img src="${imageUrl}" alt="${character.name}" class="${character.avatar ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
                    <div class="placeholder-icon ${character.avatar ? 'hidden' : ''}">👤</div>
                  </div>
                  <span>${character.name}</span>`;
                favElement.addEventListener('click', () => showChatList(charId));

                const existing = [...favBar.querySelectorAll('.favorite-item')];
                let inserted = false;
                for (const el of existing) {
                    if (character.name.localeCompare(characters[el.dataset.charId]?.name || '', 'de', { sensitivity: 'base' }) <= 0) {
                        favBar.insertBefore(favElement, el);
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) favBar.appendChild(favElement);
            } else {
                favBtn.classList.remove('is-favorite');
                favBar.querySelector(`[data-char-id="${charId}"]`)?.remove();
                if (!favBar.querySelector('.favorite-item')) {
                    favBar.innerHTML = `<span class="favorites-placeholder">No Favorites selected</span>`;
                }
            }

            // Keep avatar stacking z-indices in sync
            favBar.querySelectorAll('.favorite-item .avatar-container').forEach((el, i) => {
                el.style.zIndex = i + 1;
            });
        }
    }
    else if (event.target.classList.contains('archive-btn')) {
        event.stopPropagation();
        const card = event.target.closest('.character-card');
        toggleArchiveState(card.dataset.charId);
    }
});

archivedCharacterList.addEventListener('click', async (event) => {
    if (event.target.classList.contains('archive-btn')) { 
        event.stopPropagation();
        const card = event.target.closest('.character-card');
        toggleArchiveState(card.dataset.charId);
    }
});

archiveToggleBtn.addEventListener('click', () => {
    if (archiveContent.classList.contains('collapsed')) {
        archiveContent.style.opacity = '0';
        archiveContent.classList.remove('collapsed');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                archiveContent.style.opacity = '';
                archiveContent.querySelectorAll('.card-name-container').forEach(container => {
                    adjustFontSizeToFit(container);
                });
            });
        });
        archiveToggleBtn.textContent = 'Hide all';
    } else {
        archiveContent.style.opacity = '0';
        setTimeout(() => {
            archiveContent.classList.add('collapsed');
            archiveContent.style.opacity = '';
        }, 200);
        archiveToggleBtn.textContent = 'Show Characters';
    }
});

document.getElementById('bulk-delete-btn').addEventListener('click', openBulkCharacterDeleteModal);


    cancelEditBtn.addEventListener('click', closeEditor);
    characterForm.addEventListener('submit', handleFormSubmit);
dialogBtn.addEventListener('click', (e) => {
    e.preventDefault(); 
    handleChatSubmit('dialog');
});
storyBtn.addEventListener('click', () => {
    handleChatSubmit('story');
});



stopStreamBtn.addEventListener('click', () => {
    if (currentStreamController) {
        currentStreamController.abort();
        currentStreamController = null;
        console.log("Stream manually aborted by user.");
        stopStreamBtn.classList.add('hidden');
        loadingIndicator.classList.add('hidden');
        dialogBtn.disabled = false;
        storyBtn.disabled = false;
        // The async stream functions (handleSend / handleRegenerate / handleContinue)
        // each handle their own state cleanup when the AbortError propagates.
    }
});



    if (chatMemoriesBtn) {
        chatMemoriesBtn.addEventListener('click', () => {
            openChatMemoriesModal();
        });
    }

    if (chatMemoriesModal) {
        chatMemoriesModal.addEventListener('dblclick', (event) => {
            if (event.target === chatMemoriesModal) {
                saveChatMemories();
            }
        });
    }

    if (chatMemoriesTextarea) {
        chatMemoriesTextarea.addEventListener('input', autoResizeTextarea);
        chatMemoriesTextarea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                saveChatMemories();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeChatMemoriesModal();
            }
        });
    }



addParticipantBtn.addEventListener('click', () => {
  participantSearchInput.value = ''; 
  openParticipantModal(); 
});

participantSearchInput.addEventListener('input', () => {
  openParticipantModal(participantSearchInput.value);
});

participantSelectionModal.addEventListener('click', (event) => {
  if (event.target.id === 'cancel-participant-selection-btn') {
    participantSelectionModal.classList.add('hidden');
    participantSearchInput.value = '';
  }
});

participantSelectionList.addEventListener('click', (event) => {
    const targetBtn = event.target.closest('.participant-option-btn');
    if (targetBtn) {
        const participantId = targetBtn.dataset.charId;
        addParticipantToChat(participantId);
    }
});

messageInput.addEventListener('focus', () => {
    showGroupCharDropdown();
});

messageInput.addEventListener('click', () => {
    showGroupCharDropdown();
});

messageInput.addEventListener('blur', () => {
    setTimeout(hideGroupCharDropdown, 200);
});

groupCharDropdown.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.group-char-dropdown-item');
    if (!item) return;
    event.preventDefault(); // keeps textarea focused during selection
    const charId = item.dataset.charId;
    if (charId) setActiveGroupParticipant(charId);
});

groupCharBubbleDismiss.addEventListener('mousedown', (event) => {
    event.preventDefault(); // keeps textarea focused, prevents blur→flash cycle
    clearActiveGroupParticipant();
});

participantIconList.addEventListener('click', async (event) => {
    const iconElement = event.target.closest('[data-char-id]');
    if (!iconElement) return; 

    const charIdToRemove = iconElement.dataset.charId;
    const characterToRemove = characters[charIdToRemove];
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];

    if (!characterToRemove || !chat) return;

    if (await showCustomConfirm(`Do you really want to remove "${characterToRemove.name}" from this chat?`, true)) {
        chat.participants = chat.participants.filter(id => id !== charIdToRemove);
        await saveSingleCharacterToDB(characters[currentCharacterId]);
        updateTokenCount();
        renderParticipantIcons();
        if (charIdToRemove === activeGroupParticipantId) {
            clearActiveGroupParticipant();
        }
        if (!groupCharDropdown.classList.contains('hidden')) {
            showGroupCharDropdown();
        }
    }
});

selectPersonaBtn.addEventListener('click', async () => {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    if (chat?.activePersonaId) {
        const personaName = personas[chat.activePersonaId]?.name || 'the current persona';
        if (await showCustomConfirm(`Do you want to unselect "${personaName}"?`)) {
            chat.activePersonaId = null;
            await saveSingleCharacterToDB(characters[currentCharacterId]);
            updateTokenCount();
            startChat(currentCharacterId, currentChatId);
            showCustomAlert(`Persona "${personaName}" has been unselected.`);
        }
    } else {
        personaSearchInput.value = '';
        openPersonaSelectionModal();
    }
});

personaSearchInput.addEventListener('input', () => {
  openPersonaSelectionModal(personaSearchInput.value);
});

cancelPersonaSelectBtn.addEventListener('click', () => {
    personaSelectionModal.classList.add('hidden');
});

personaSelectionList.addEventListener('click', (event) => {
    const targetBtn = event.target.closest('.participant-option-btn');
    if (targetBtn) {
        const personaId = targetBtn.dataset.personaId;
        setActivePersonaForChat(personaId);
    }
});

backToSelectionBtn.addEventListener('click', showCharacterSelection);
    backToMainBtn.addEventListener('click', showMainScreen);

startNewChatBtn.addEventListener('click', async () => {
    const character = characters[currentCharacterId];
    if (!character.scenarios || character.scenarios.length === 0) {
        await createNewChat();
        return;
    }

    scenarioSelectionList.innerHTML = '';
    character.scenarios.forEach(scenario => {
        const scenarioBtn = document.createElement('button');
        scenarioBtn.className = 'scenario-option-btn';
        scenarioBtn.textContent = scenario.name || 'Unnamed Scenario';
        scenarioBtn.dataset.scenarioText = scenario.text; 
        scenarioSelectionList.appendChild(scenarioBtn);
    });
    scenarioSelectionModal.classList.remove('hidden');
});

scenarioSelectionList.addEventListener('click', async (event) => {
    if (event.target.classList.contains('scenario-option-btn')) {
        const scenarioText = event.target.dataset.scenarioText;
        scenarioSelectionModal.classList.add('hidden');
        const scenarioName = event.target.textContent;
        await createNewChat(scenarioText, scenarioName);
    }
});

startEmptyChatBtn.addEventListener('click', async () => {
    scenarioSelectionModal.classList.add('hidden');
    await createNewChat();
});

cancelScenarioSelectionBtn.addEventListener('click', () => {
    scenarioSelectionModal.classList.add('hidden');
});

    exportBtn.addEventListener('click', handleExport);
    importBtn.addEventListener('click', async () => {
  const choice = await showChoiceDialog(
    "What do you want to import?",
    [
      { label: "Backup (.json)", value: "json", primary: true },
      { label: "Character Card (.png/.json)", value: "card", extraClass: "violet-btn" },
      { label: "Cancel", value: null }
    ]
  );
  if (!choice) return;
  if (choice === "json") {
    fileInput.setAttribute('accept', '.json,application/json');
  } else {
    fileInput.setAttribute('accept', '.json,application/json,image/png');
  }
  fileInput.click();
});
    fileInput.addEventListener('change', handleFileImport);
    messageInput.addEventListener('input', autoResizeTextarea);
    messageInput.addEventListener('keydown', handleTextareaEnter);
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        settingsPanel.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!settingsPanel.classList.contains('hidden') && !settingsContainer.contains(e.target)) {
            settingsPanel.classList.add('hidden');
        }
    });

    addSettingListener(fontSizeSlider, 'fontSize');
    addSettingListener(temperatureSlider, 'temperature');
    addSettingListener(mainTextColorPicker, 'mainTextColor');
    addSettingListener(dialogueColorPicker, 'dialogueColor');
    addSettingListener(userBubbleColorPicker, 'userBubbleColor');
    addSettingListener(userBubbleOpacitySlider, 'userBubbleOpacity');
    addSettingListener(aiBubbleColorPicker, 'aiBubbleColor');
    addSettingListener(aiBubbleOpacitySlider, 'aiBubbleOpacity');
    addSettingListener(spacingSlider, 'messageSpacing');
    addSettingListener(soundToggle, 'soundEnabled', 'change');
    addSettingListener(thinkToggle, 'thinkEnabled', 'change');
    addSettingListener(blurSlider, 'blur');
    addSettingListener(avatarSizeSlider, 'avatarSize');
    addSettingListener(modelSelect, 'model', 'change');
    addSettingListener(avatarSizeSlider, 'avatarSize');

    if (typeof window !== 'undefined') {
        if (responsiveViewportQuery) {
            const viewportChangeHandler = enforceResponsiveSettingLimits;
            if (typeof responsiveViewportQuery.addEventListener === 'function') {
                responsiveViewportQuery.addEventListener('change', viewportChangeHandler);
            } else if (typeof responsiveViewportQuery.addListener === 'function') {
                responsiveViewportQuery.addListener(viewportChangeHandler);
            }
        }
        window.addEventListener('resize', enforceResponsiveSettingLimits);
    }

    resetSettingsBtn.addEventListener('click', async () => {
        if (await showCustomConfirm("Do you really want to reset all settings to the default values?", true)) {
            Object.keys(defaultSettings).forEach(key => localStorage.removeItem(key));
            loadAndApplySettings();
            enforceResponsiveSettingLimits();
        }
    });

    scrollTopFab.addEventListener('click', () => {
        chatWindow.scrollTop = 0;
    });

    chatWindow.addEventListener('scroll', () => {
        if (chatWindow.scrollTop > 400) {
            scrollTopFab.classList.add('visible');
        } else {
            scrollTopFab.classList.remove('visible');
        }
        const k = (currentCharacterId && currentChatId)
  ? `chatScrollPos:${currentCharacterId}:${currentChatId}`
  : 'chatScrollPos';
localStorage.setItem(k, String(chatWindow.scrollTop));
        chatWindow._autoScroll = chatWindow.scrollHeight - chatWindow.clientHeight - chatWindow.scrollTop < 50;
    }, { passive: true });

    chatWindow.addEventListener('dblclick', (event) => {
        const partElement = event.target.closest('[data-edit-part="main"]');
        if (!partElement) return;

        const messageElement = partElement.closest('.message');
        const messageId = messageElement.dataset.messageId;

        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat) return;

        const message = chat.history.find(m => m.id === messageId);
        if (!message) return;
        
        let textToEdit = '';
        if(message.sender === 'user') {
            textToEdit = message.main;
        } else {
            textToEdit = 
            message.variations[message.activeVariant].main;
        }

        messageEditorTextarea.value = textToEdit || '';
        messageEditorModal.dataset.editingMessageId = messageId;
        
        messageEditorModal.classList.remove('hidden');
        messageEditorTextarea.focus();
        messageEditorTextarea.addEventListener('input', autoResizeTextarea);
        autoResizeTextarea({ target: messageEditorTextarea });
    });

    messageEditorModal.addEventListener('dblclick', (event) => {
        if (event.target === messageEditorModal) {
            saveAndCloseMessageEditor();
        }
    });

    messageEditorTextarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            saveAndCloseMessageEditor();
        }
    });

    saveMessageEditBtn.addEventListener('click', () => saveAndCloseMessageEditor());
    cancelMessageEditBtn.addEventListener('click', () => {
        messageEditorModal.classList.add('hidden');
        delete messageEditorModal.dataset.editingMessageId;
    });

    saveMemoriesEditBtn.addEventListener('click', () => saveChatMemories());
    cancelMemoriesEditBtn.addEventListener('click', () => closeChatMemoriesModal());

    chatWindow.addEventListener('click', async (event) => {
        const target = event.target;
        const messageElement = target.closest('.message');
        if (!messageElement) return;

        const messageId = messageElement.dataset.messageId;
        
        if (target.classList.contains('regenerate-btn')) {
            await handleRegenerate(messageId);
        }
        else if (target.classList.contains('edit-message-btn')) {
            const chat = characters[currentCharacterId]?.chats?.[currentChatId];
            if (!chat) return;
            const message = chat.history.find(m => m.id === messageId);
            if (!message) return;
            let textToEdit = '';
            if (message.sender === 'user') {
                textToEdit = message.main;
            } else {
                textToEdit = message.variations[message.activeVariant].main;
            }
            messageEditorTextarea.value = textToEdit || '';
            messageEditorModal.dataset.editingMessageId = messageId;
            messageEditorModal.classList.remove('hidden');
            messageEditorTextarea.focus();
            messageEditorTextarea.addEventListener('input', autoResizeTextarea);
            autoResizeTextarea({ target: messageEditorTextarea });
        }
        else if (target.classList.contains('delete-message-btn')) {
             if (await showCustomConfirm("Are you sure you want to permanently delete this message AND ALL FOLLOWING messages?", true)) {
                const chat = characters[currentCharacterId]?.chats?.[currentChatId];
            if (!chat) return;
            const messageIndex = chat.history.findIndex(m => m.id === messageId);
            const currentScroll = chatWindow.scrollTop;
            chat.history.splice(messageIndex);
            await saveSingleCharacterToDB(characters[currentCharacterId]);
            updateTokenCount();
            startChat(currentCharacterId, currentChatId);
            chatWindow.scrollTop = currentScroll;
                }
             }
             else if (target.classList.contains('continue-btn')) {
        await handleContinue(messageId);
             }
        else if (target.classList.contains('prev-variant-btn') || target.classList.contains('next-variant-btn')) {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat) return;
        const message = chat.history.find(m => m.id === messageId);
        if (!message) return;
        
        let changed = false;
        if (target.classList.contains('prev-variant-btn') && message.activeVariant > 0) {
            message.activeVariant--;
            changed = true;
        } else if (target.classList.contains('next-variant-btn') && message.activeVariant < message.variations.length - 1) {
            message.activeVariant++;
            changed = true;
        }

        if (changed) {
            await saveSingleCharacterToDB(characters[currentCharacterId]);
            updateTokenCount();
            updateSingleMessageView(messageId);
        }
    }
    });



    document.addEventListener('keydown', async (event) => {
        if (chatScreen.classList.contains('hidden')) return;
        if (document.activeElement === messageInput || document.activeElement === messageEditorTextarea || document.activeElement === chatMemoriesTextarea) return;
        if (chatMemoriesModal && !chatMemoriesModal.classList.contains('hidden')) return;
        
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat || chat.history.length === 0) return;
        
        const lastMessage = chat.history[chat.history.length - 1];
        if (!lastMessage || lastMessage.sender !== 'ai') return;

        let changed = false;
        if (event.key === 'ArrowLeft') {
            if (lastMessage.variations.length > 1 && lastMessage.activeVariant > 0) {
                lastMessage.activeVariant--;
                changed = true;
            }
        } else if (event.key === 'ArrowRight') {
             if (lastMessage.activeVariant < lastMessage.variations.length - 1) {
                lastMessage.activeVariant++;
                changed = true;
            } else {
                event.preventDefault();
                await handleRegenerate(lastMessage.id);
                return;
            }
        }

        if (changed) {
            event.preventDefault();
            await saveSingleCharacterToDB(characters[currentCharacterId]);
            const currentScroll = chatWindow.scrollTop;
            startChat(currentCharacterId, currentChatId);
            chatWindow.scrollTop = currentScroll;
        }
    });

    deleteCharacterBtnDashboard.addEventListener('click', async () => {
    if (!currentCharacterId || !characters[currentCharacterId]) return;
    const characterName = characters[currentCharacterId].name;
    if (await showCustomConfirm(`Are you sure you want to permanently delete the character "${characterName}" and all their chats?`, true)) {
        const idToDelete = currentCharacterId; 
        delete characters[idToDelete];
        await deleteSingleCharacterFromDB(idToDelete);
        renderCharacterList();
        showMainScreen();
    }
});

cancelEditBtnTop.addEventListener('click', closeEditor);

saveEditBtnTop.addEventListener('click', () => {
    document.getElementById('save-edit-btn-bottom').click();
});



let targetScrollTop = characterEditorModalContent.scrollTop;
let currentScrollTop = characterEditorModalContent.scrollTop;
let animationFrameId = null;
const smoothing = 0.1;

function smoothScrollLoop() {
    const distance = targetScrollTop - currentScrollTop;

    if (Math.abs(distance) < 0.5) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        return;
    }

    currentScrollTop += distance * smoothing;
    characterEditorModalContent.scrollTop = currentScrollTop;

    animationFrameId = requestAnimationFrame(smoothScrollLoop);
}

characterEditorModal.addEventListener('wheel', (event) => {
    if (event.target === characterEditorModal) {
        event.preventDefault();

        if (animationFrameId === null) {
            currentScrollTop = characterEditorModalContent.scrollTop;
            targetScrollTop = characterEditorModalContent.scrollTop;
        }

        targetScrollTop += event.deltaY;

        const maxScroll = characterEditorModalContent.scrollHeight - characterEditorModalContent.clientHeight;
        targetScrollTop = Math.max(0, Math.min(maxScroll, targetScrollTop));

        if (animationFrameId === null) {
            animationFrameId = requestAnimationFrame(smoothScrollLoop);
        }
    }
});



const editorTextareasToResize = [
    'char-description',
    'char-lore',
    'char-instructions',
    'char-reminder',
    'char-narrator-reminder',
    'scenario-list'
];

editorTextareasToResize.forEach(id => {
    const textarea = document.getElementById(id);
    if (textarea) {
        textarea.addEventListener('input', autoResizeTextarea);
    }
});



    // --- INITIALIZATION ---


async function initializeApp() {
    try {
        await openDB();
        await Promise.all([
            loadCharactersFromDB(),
            loadPersonasFromDB(),
            loadAppSettingsFromDB(),
        ]);
        populateModelSelector();
        await loadAndApplySettingsFromDB();
        if (Object.keys(characters).length === 0) {
            await loadStarterPack();
        }
        enforceResponsiveSettingLimits();
        renderCharacterList();
        restoreLastSession();
        tutorialInit();
    } catch (error) {
        console.error("Failed to initialize the app:", error);
        showCustomAlert("Could not load database. Please check browser permissions or try clearing site data.");
    }
}
initializeApp();



function adjustCardImageFit() {
    const cardImages = document.querySelectorAll('.card-image-container img');
    cardImages.forEach(img => {
        const checkAndSetFit = (imageElement) => {
            const isPortrait = imageElement.naturalWidth < imageElement.naturalHeight;

            if (isPortrait) {
                imageElement.style.objectFit = 'contain';
                imageElement.parentElement.style.backgroundColor = 'rgba(0,0,0,0.5)';
            } else {
                imageElement.style.objectFit = 'cover';
                imageElement.parentElement.style.backgroundColor = ''; 
            }
        };

        if (img.complete && img.naturalWidth > 0) {
            checkAndSetFit(img);
        } else {
            img.onload = () => checkAndSetFit(img);
        }
    });
}



async function loadStarterPack() {
    try {
        let data;
        if (typeof STARTER_PACK_DATA !== 'undefined') {
            data = STARTER_PACK_DATA;
        } else {
            const response = await fetch('starter_pack_data.json');
            if (!response.ok) throw new Error('Failed to fetch starter_pack_data.json: ' + response.status);
            data = await response.json();
        }

        const starterChars = data.characters;
        if (starterChars && Object.keys(starterChars).length > 0) {
            console.log('First launch: Loading starter pack characters...');

            for (const charId in starterChars) {
                characters[charId] = starterChars[charId];
            }

            await saveCharactersToDB();

            const starterAppSettings = data.appSettings;
            if (starterAppSettings && db) {
                console.log('First launch: Loading app settings from starter pack...');
                const transaction = db.transaction(['settings'], 'readwrite');
                const store = transaction.objectStore('settings');
                store.put({ key: 'appSettings', value: starterAppSettings });
            }
        }

        const starterPersonas = data.personas;
        if (starterPersonas && Object.keys(starterPersonas).length > 0) {
            console.log('First launch: Loading starter pack personas...');
            for (const personaId in starterPersonas) {
                personas[personaId] = starterPersonas[personaId];
            }
            await savePersonasToDB();
        }
    } catch (error) {
        console.warn("Error loading starter pack data from script:", error.message);
    }
}



document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        document.body.classList.add('fullscreen-active');
    } else {
        document.body.classList.remove('fullscreen-active');
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'f' && 
        document.activeElement.tagName !== 'INPUT' && 
        document.activeElement.tagName !== 'TEXTAREA') {
        
        event.preventDefault(); 

        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }
});



const charAvatarInput = document.getElementById('char-avatar');
charAvatarInput.addEventListener('input', () => {
    const url = charAvatarInput.value;
    const editorAvatarContainer = editorAvatarImg.parentElement;
    if (url) {
        editorAvatarImg.src = url;
        smartObjectFit(editorAvatarImg); 
        editorAvatarImg.classList.remove('hidden');
        editorAvatarPlaceholder.classList.add('hidden');
        editorAvatarContainer.classList.add('effect-container');
        editorAvatarContainer.style.backgroundImage = `url('${url}')`;
    } else {
        editorAvatarImg.classList.add('hidden');
        editorAvatarPlaceholder.classList.remove('hidden');
        editorAvatarContainer.classList.remove('effect-container');
        editorAvatarContainer.style.backgroundImage = 'none';
    }
});

editorAvatarImg.onerror = () => {
    editorAvatarImg.classList.add('hidden');
    editorAvatarPlaceholder.classList.remove('hidden');
    const container = editorAvatarImg.parentElement;
    container.classList.remove('effect-container');
    container.style.backgroundImage = 'none';
};

const charBackgroundInput = document.getElementById('char-background');
const chatListScreenForPreview = document.getElementById('chat-list-screen');

charBackgroundInput.addEventListener('input', () => {
    const url = charBackgroundInput.value;
    if (url) {
        chatListScreenForPreview.style.backgroundImage = `url('${url}')`;
        chatListScreenForPreview.style.backgroundSize = 'cover';
        chatListScreenForPreview.style.backgroundPosition = 'center';
    } else {
        chatListScreenForPreview.style.backgroundImage = 'none';
        chatListScreenForPreview.style.backgroundColor = 'transparent';
    }
});



const modalsToFixScroll = ['app-settings-modal', 'persona-editor-modal', 'persona-list-modal'];

modalsToFixScroll.forEach(modalId => {
    const modalElement = document.getElementById(modalId);
    if (modalElement) {
        modalElement.addEventListener('wheel', (event) => {
            if (event.target === modalElement) {
                event.preventDefault();
            }
        }, { passive: false });
    }
});



const helpBtn = document.getElementById('help-btn');
const helpDot = document.getElementById('help-notification-dot');
const helpTooltip = document.getElementById('help-tooltip');

if (!localStorage.getItem('hasSeenHelpNotification')) {
    helpDot.classList.remove('hidden');
    helpTooltip.classList.remove('hidden');
}

helpBtn.addEventListener('click', () => {
    if (!localStorage.getItem('hasSeenHelpNotification')) {
        localStorage.setItem('hasSeenHelpNotification', 'true');
    }
    helpDot.classList.add('hidden');
    helpTooltip.classList.add('hidden');
});


// =============================================================
// TUTORIAL TOUR MODULE
// =============================================================

const tutorialData = {
    active: false,
    currentStep: 0,
    pendingPhase: null,
    localStorageKey: 'tutorialCompleted',
    steps: [
        // Phase 1 — Character Selection Screen
        {
            phase: 'character-selection',
            targetId: null,
            position: 'center',
            indicator: 'Welcome',
            title: 'Welcome to Casual Character Chat!',
            text: "This quick tour will show you the basics. It only takes a moment — feel free to skip anytime.",
            nextLabel: "Let's Go",
        },
        {
            phase: 'character-selection',
            targetId: 'app-settings-btn',
            position: 'bottom',
            indicator: 'Step 1 of 6',
            title: 'Enter your API Key first',
            text: 'Open Global Settings to add your AI API key. This is your first stop — no key, no AI chat.',
            nextLabel: 'Next',
        },
        {
            phase: 'character-selection',
            targetId: 'new-character-btn',
            position: 'bottom',
            indicator: 'Step 2 of 7',
            title: 'Create your first character',
            text: 'Give them a name, personality, and avatar. This is who you\'ll be chatting with.',
            nextLabel: 'Next',
        },
        {
            phase: 'character-selection',
            targetId: 'manage-personas-btn',
            position: 'bottom',
            indicator: 'Step 3 of 7',
            title: 'Play as your own persona',
            text: 'Optionally create a persona for yourself — useful if you like to roleplay as a specific character or personality across chats.',
            nextLabel: 'Got it',
        },
        // Phase 2 — Chat List Screen
        {
            phase: 'chat-list',
            targetId: 'start-new-chat-btn',
            position: 'top',
            indicator: 'Step 4 of 7',
            title: 'Start a new conversation',
            text: 'Click here to begin a fresh chat session with your character.',
            nextLabel: 'Next',
        },
        {
            phase: 'chat-list',
            targetId: 'edit-character-btn',
            position: 'top',
            indicator: 'Step 5 of 7',
            title: 'Edit your character anytime',
            text: 'Refine their personality, add scenarios, or change their avatar here.',
            nextLabel: 'Got it',
        },
        // Phase 3 — Chat Screen
        {
            phase: 'chat',
            targetId: 'chat-form',
            position: 'top',
            indicator: 'Step 6 of 7',
            title: 'Type your message here',
            text: '"Character" sends an AI reply. "Narrator" adds story narration. Try both!',
            nextLabel: 'Next',
        },
        {
            phase: 'chat',
            targetId: 'settings-container',
            position: 'bottom',
            indicator: 'Step 7 of 7',
            title: 'Your chat control panel',
            text: 'Memories, group chat, persona, and settings all live up here. That\'s the tour!',
            nextLabel: 'Done!',
        },
    ],
};

const tutorialBackdrop        = document.getElementById('tutorial-backdrop');
const tutorialSpotlight       = document.getElementById('tutorial-spotlight');
const tutorialTooltipEl       = document.getElementById('tutorial-tooltip');
const tutorialStepIndicatorEl = document.getElementById('tutorial-step-indicator');
const tutorialTitleEl         = document.getElementById('tutorial-title');
const tutorialTextEl          = document.getElementById('tutorial-text');
const tutorialSkipBtn         = document.getElementById('tutorial-skip-btn');
const tutorialNextBtn         = document.getElementById('tutorial-next-btn');

function tutorialGetActivePhase() {
    if (!characterSelectionScreen.classList.contains('is-inactive')) return 'character-selection';
    if (!chatListScreen.classList.contains('is-inactive'))           return 'chat-list';
    if (!chatScreen.classList.contains('is-inactive'))               return 'chat';
    return null;
}

function tutorialPositionSpotlight(step) {
    if (!step.targetId) {
        tutorialSpotlight.classList.add('tutorial-welcome');
        tutorialSpotlight.style.cssText = '';
        return null;
    }
    tutorialSpotlight.classList.remove('tutorial-welcome');
    const el = document.getElementById(step.targetId);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const pad = 7;
    tutorialSpotlight.style.top    = (rect.top    - pad) + 'px';
    tutorialSpotlight.style.left   = (rect.left   - pad) + 'px';
    tutorialSpotlight.style.width  = (rect.width  + pad * 2) + 'px';
    tutorialSpotlight.style.height = (rect.height + pad * 2) + 'px';
    return rect;
}

function tutorialComputeTooltipPos(targetRect, position) {
    const MARGIN = 14;
    const PAD    = 12;
    const tw = tutorialTooltipEl.offsetWidth  || 300;
    const th = tutorialTooltipEl.offsetHeight || 160;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (position === 'center') {
        return { top: (vh - th) / 2, left: (vw - tw) / 2 };
    }

    const midX = targetRect.left + targetRect.width  / 2;
    let top, left;

    if (position === 'bottom') {
        top  = targetRect.bottom + MARGIN;
        left = midX - tw / 2;
    } else if (position === 'top') {
        top  = targetRect.top - th - MARGIN;
        left = midX - tw / 2;
    } else if (position === 'left') {
        top  = targetRect.top + targetRect.height / 2 - th / 2;
        left = targetRect.left - tw - MARGIN;
    } else {
        top  = targetRect.top + targetRect.height / 2 - th / 2;
        left = targetRect.right + MARGIN;
    }

    if (top + th > vh - PAD) top = targetRect.top - th - MARGIN;
    if (top < PAD)           top = targetRect.bottom + MARGIN;
    left = Math.max(PAD, Math.min(left, vw - tw - PAD));

    return { top, left };
}

function tutorialHideUI() {
    tutorialSpotlight.classList.remove('tutorial-visible');
    tutorialTooltipEl.classList.remove('tutorial-visible');
    setTimeout(() => {
        tutorialBackdrop.classList.remove('tutorial-active');
        tutorialSpotlight.classList.remove('tutorial-active', 'tutorial-welcome');
        tutorialTooltipEl.classList.remove('tutorial-active', 'tutorial-centered');
    }, 260);
}

function tutorialComplete() {
    localStorage.setItem(tutorialData.localStorageKey, 'true');
    tutorialData.active = false;
    tutorialData.pendingPhase = null;
    tutorialSpotlight.classList.remove('tutorial-visible');
    tutorialTooltipEl.classList.remove('tutorial-visible');
    setTimeout(() => {
        tutorialBackdrop.classList.remove('tutorial-active');
        tutorialSpotlight.classList.remove('tutorial-active', 'tutorial-welcome');
        tutorialTooltipEl.classList.remove('tutorial-active', 'tutorial-centered');
        tutorialSpotlight.style.cssText = '';
        tutorialTooltipEl.style.cssText = '';
    }, 280);
}

function tutorialShowStep(stepIndex) {
    if (stepIndex >= tutorialData.steps.length) {
        tutorialComplete();
        return;
    }

    const step = tutorialData.steps[stepIndex];
    tutorialData.currentStep = stepIndex;

    const activePhase = tutorialGetActivePhase();
    if (step.phase !== activePhase) {
        tutorialData.pendingPhase = step.phase;
        tutorialHideUI();
        return;
    }

    tutorialData.pendingPhase = null;

    tutorialStepIndicatorEl.textContent = step.indicator;
    tutorialTitleEl.textContent         = step.title;
    tutorialTextEl.textContent          = step.text;
    tutorialNextBtn.textContent         = step.nextLabel;

    tutorialBackdrop.classList.add('tutorial-active');
    tutorialSpotlight.classList.add('tutorial-active');
    tutorialTooltipEl.classList.add('tutorial-active');

    if (step.position === 'center') {
        tutorialTooltipEl.classList.add('tutorial-centered');
    } else {
        tutorialTooltipEl.classList.remove('tutorial-centered');
    }

    const targetRect = tutorialPositionSpotlight(step);

    if (step.position !== 'center') {
        const pos = tutorialComputeTooltipPos(
            targetRect || { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 },
            step.position
        );
        tutorialTooltipEl.style.top  = pos.top  + 'px';
        tutorialTooltipEl.style.left = pos.left + 'px';
    }

    requestAnimationFrame(() => {
        tutorialSpotlight.classList.add('tutorial-visible');
        tutorialTooltipEl.classList.add('tutorial-visible');
    });
}

function tutorialOnScreenChange(screenName) {
    if (!tutorialData.active) return;
    if (tutorialData.pendingPhase !== screenName) return;
    setTimeout(() => {
        const stepIndex = tutorialData.steps.findIndex(s => s.phase === screenName);
        if (stepIndex !== -1) tutorialShowStep(stepIndex);
    }, 260);
}

function tutorialInit() {
    if (localStorage.getItem(tutorialData.localStorageKey)) return;
    tutorialData.active = true;
    const currentPhase = tutorialGetActivePhase();
    if (currentPhase === 'chat-list') {
        const i = tutorialData.steps.findIndex(s => s.phase === 'chat-list');
        tutorialShowStep(i);
    } else if (currentPhase === 'chat') {
        const i = tutorialData.steps.findIndex(s => s.phase === 'chat');
        tutorialShowStep(i);
    } else {
        tutorialShowStep(0);
    }
}

tutorialSkipBtn.addEventListener('click', () => {
    tutorialComplete();
});

tutorialNextBtn.addEventListener('click', () => {
    if (!tutorialData.active) return;
    tutorialShowStep(tutorialData.currentStep + 1);
});

tutorialBackdrop.addEventListener('click', (e) => {
    e.stopPropagation();
});

let tutorialResizeTimer;
window.addEventListener('resize', () => {
    if (!tutorialData.active || tutorialData.pendingPhase !== null) return;
    clearTimeout(tutorialResizeTimer);
    tutorialResizeTimer = setTimeout(() => {
        const step = tutorialData.steps[tutorialData.currentStep];
        if (!step) return;
        const targetRect = tutorialPositionSpotlight(step);
        if (step.position !== 'center' && targetRect) {
            const pos = tutorialComputeTooltipPos(targetRect, step.position);
            tutorialTooltipEl.style.top  = pos.top  + 'px';
            tutorialTooltipEl.style.left = pos.left + 'px';
        }
    }, 120);
});

// =============================================================
// END TUTORIAL TOUR MODULE
// =============================================================


});
