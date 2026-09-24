document.addEventListener('DOMContentLoaded', () => {
const CCC_MOOD_DEFINITIONS = Object.freeze({
    Happy: Object.freeze({ emoji: '😊' }),
    Sad: Object.freeze({ emoji: '😢' }),
    Angry: Object.freeze({ emoji: '😠' }),
    Excited: Object.freeze({ emoji: '🤩' }),
    Nervous: Object.freeze({ emoji: '😰' }),
    Flirty: Object.freeze({ emoji: '😏' }),
    Tired: Object.freeze({ emoji: '😴' }),
    Curious: Object.freeze({ emoji: '🧐' }),
    Scared: Object.freeze({ emoji: '😨' }),
    Bored: Object.freeze({ emoji: '😑' })
});

const CCC_MOOD_LOOKUP = Object.freeze(Object.fromEntries(
    Object.keys(CCC_MOOD_DEFINITIONS).map(mood => [mood.toLowerCase(), mood])
));

function normalizeMood(value) {
    if (typeof value !== 'string') return null;
    return CCC_MOOD_LOOKUP[value.trim().toLowerCase()] || null;
}

function getMoodEmoji(value) {
    const mood = normalizeMood(value);
    return mood ? CCC_MOOD_DEFINITIONS[mood].emoji : '😊';
}

function getMoodSystemContext({ mood: rawMood, characterName, isNarration = false }) {
    const mood = normalizeMood(rawMood);
    if (!mood) return '';

    if (isNarration) {
        return `--- CURRENT SCENE MOOD (ACTIVE) ---
Mood: ${mood}
Use this as the scene's current emotional atmosphere. Consistently but naturally reflect it in the narration, pacing, imagery, and reactions. Do not announce, label, or explain the mood unless it arises naturally in the story. Keep it active for this response.

`;
    }

    const safeCharacterName = typeof characterName === 'string' && characterName.trim()
        ? characterName.trim()
        : 'The character';
    return `--- CHARACTER CURRENT MOOD (ACTIVE) ---
Character: ${safeCharacterName}
Mood: ${mood}
Treat this as the character's current emotional state. Consistently but naturally reflect it in their word choice, expressions, decisions, and reactions. Do not announce, label, or explain the mood unless it arises naturally in the story. Keep it active for this response.

`;
}

/* ===========================================================================
 * SCENARIO MEMORIES
 * ===========================================================================
 * A scenario used to be one blob of text that became the chat's first message.
 * It is now two fields:
 *
 *   Greeting - the first message, and nothing else. It scrolls out of the
 *              model's attention as the chat grows, which is exactly why
 *              anything written into it as "later" gets played immediately.
 *   Memories - what this story has to keep in mind, including what is still to
 *              come. The scenario holds the starting text; a chat started from
 *              it gets its own copy in the Chat Memories panel, and that copy
 *              is what is sent with every request.
 *
 * The scenario side is only a template. Everything the model is told about the
 * text itself lives with the CHAT MEMORIES block in the request builders, so
 * there is no second prompt block and nothing here is tracked, ticked or
 * counted.
 * ======================================================================== */

function normalizeMemories(value) {
    if (typeof value === 'string') return value.trim();
    // The shapes this replaced: a Story Line, and before that a General Plot
    // plus an ordered milestone list. Fold them in rather than drop them.
    if (value && typeof value === 'object') {
        if (typeof value.storyLine === 'string') return value.storyLine.trim();
        const plot = typeof value.generalPlot === 'string' ? value.generalPlot.trim() : '';
        const steps = Array.isArray(value.milestones)
            ? value.milestones
                .map(m => (typeof m === 'string' ? m : ((m && typeof m.text === 'string') ? m.text : '')).trim())
                .filter(Boolean)
            : [];
        const route = steps.map((t, i) => `${i + 1}. ${t}`).join('\n');
        return [plot, route].filter(Boolean).join('\n\n');
    }
    return '';
}

// Turns anything that has ever been stored as a scenario into the split shape.
// This runs on every load, so it must leave an already-split scenario alone.
function normalizeScenario(scenario, index = 0) {
    if (typeof scenario === 'string') scenario = { name: `Scenario ${index + 1}`, text: scenario };
    if (!scenario || typeof scenario !== 'object') return null;
    // `text` is what every scenario saved before the split has, and what the
    // card converter still sends. It is the greeting - never drop it.
    const greeting = typeof scenario.greeting === 'string'
        ? scenario.greeting
        : (typeof scenario.text === 'string' ? scenario.text : '');
    const name = (typeof scenario.name === 'string' && scenario.name.trim())
        ? scenario.name
        : 'Unnamed Scenario';
    // Handing the whole scenario on lets normalizeMemories pick up a Story Line,
    // or an older plot/milestone pair, when there are no memories yet.
    return { name, greeting, memories: normalizeMemories(scenario.memories ?? scenario) };
}

function normalizeScenarioList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((s, i) => normalizeScenario(s, i)).filter(Boolean);
}

/* A chat carries its own memories, so rewriting them mid-chat leaves the
 * scenario and every other chat started from it alone. Older builds kept a
 * separate Story Line beside them (`storyLine`, and `plan` before that); that
 * is memory text too, so it is folded in rather than dropped. */
function getChatMemories(chat) {
    if (!chat) return '';
    const own = typeof chat.memories === 'string' ? chat.memories.trim() : '';
    const carried = normalizeMemories(typeof chat.storyLine === 'string' ? chat.storyLine : chat.plan);
    if (!carried) return own;
    return own ? `${own}\n\n${carried}` : carried;
}

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



// The starter pack is the single source of truth for the models the app ships
// with: it carries each one's instructions and reminders, so reading the list
// from there is what keeps a second, hand-kept copy from going stale.
const STARTER_PACK_MODELS = (() => {
    if (typeof STARTER_PACK_DATA === 'undefined') return [];
    const packModels = STARTER_PACK_DATA?.appSettings?.availableModels;
    if (!Array.isArray(packModels)) return [];
    return packModels.filter(m => m && m.id).map(m => ({ ...m }));
})();

// Preselected in chat settings, and the fallback whenever the selector is
// holding an id that the model list no longer contains.
const DEFAULT_MODEL_ID = "openrouter/free";

// Only reached when starter_pack_data.js is missing, which is why it is one
// usable model rather than a second copy of the pack.
const availableModels = STARTER_PACK_MODELS.length > 0
    ? STARTER_PACK_MODELS
    : [{ id: DEFAULT_MODEL_ID, name: "Openrouter: Free (random free model)" }];

// Installs made before the model list was taken from the starter pack hold a
// single entry for the retired GLM 4.5 Air default. This id exists only so that
// leftover can be recognised and replaced; it is never offered as a model.
const RETIRED_DEFAULT_MODEL_ID = "z-ai/glm-4.5-air:free";

// True only for that untouched one-entry list. Anyone who has added, renamed or
// removed a model no longer matches, so a curated list is never overwritten.
function isUntouchedRetiredModelList(models) {
    return Array.isArray(models)
        && models.length === 1
        && models[0]
        && models[0].id === RETIRED_DEFAULT_MODEL_ID;
}

function resolveDefaultModelId(models) {
    const list = Array.isArray(models) ? models : [];
    if (list.some(m => m && m.id === DEFAULT_MODEL_ID)) return DEFAULT_MODEL_ID;
    return list.length > 0 ? list[0].id : DEFAULT_MODEL_ID;
}

// Selects the first candidate id the <select> actually holds. Assigning an id
// that is not among the options leaves the select blank, which is how a single
// stale saved model used to hide the whole list.
function setSelectValueWithFallback(select, candidates) {
    if (!select) return '';
    for (const candidate of candidates) {
        if (!candidate) continue;
        select.value = candidate;
        if (select.value === candidate) return select.value;
    }
    if (select.options.length > 0) select.selectedIndex = 0;
    return select.value;
}



const APP_VERSION = 1.0;



const DEFAULT_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// --- Image generation -------------------------------------------------------
// Released. Set this back to false to withdraw the feature from users
// without removing the code; it then shows only on localhost, or to
// anyone who sets localStorage.cccImageGenBeta = '1'.
const IMAGE_GEN_PUBLIC_LAUNCH = true;

function isImageGenUnlocked() {
    if (IMAGE_GEN_PUBLIC_LAUNCH) return true;
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true;
    try {
        return localStorage.getItem('cccImageGenBeta') === '1';
    } catch (_) {
        return false;
    }
}

const OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/images";
const POLLINATIONS_IMAGE_URL = "https://image.pollinations.ai/prompt/";
// The free tier queues anonymous requests; measured waits reached ~45s under
// load, so a short timeout would report failures for images that do arrive.
const IMAGE_GEN_TIMEOUT_MS = 120000;
const IMAGE_GEN_SIZE = 768;
// Stored base64 images ride along in the character record on every save, so the
// paid path is capped per chat. The free path stores a URL and is not counted.
const IMAGE_GEN_STORED_LIMIT = 6;
// How much of the scene is read when distilling a prompt. Generous on purpose:
// the telling detail is often in the last lines of a long reply, and cutting
// early loses it. A full "very long" reply is roughly 3000 characters.
const IMAGE_PROMPT_SCENE_CHARS = 4000;
const IMAGE_PROMPT_APPEARANCE_CHARS = 1200;
// Used only when no text model is available to distil, so the raw scene text
// becomes the prompt. Still bounded, since image models ignore long tails.
const IMAGE_PROMPT_FALLBACK_CHARS = 800;
// Pollinations carries the prompt in the URL path, where percent-encoding can
// triple the length, so the prompt is bounded to keep the request sane.
const IMAGE_PROMPT_URL_CHARS = 1500;

const OPENROUTER_REASONING_EFFORTS = new Set([
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
]);
const REASONING_REQUIRED_MODELS = new Set([
    'z-ai/glm-5.3-flash'
]);

function isOpenRouterChatCompletionsUrl(value) {
    try {
        const url = new URL(value);
        const pathname = url.pathname.replace(/\/+$/, '') || '/';
        return url.protocol === 'https:'
            && url.hostname.toLowerCase() === 'openrouter.ai'
            && (url.port === '' || url.port === '443')
            && url.username === ''
            && url.password === ''
            && pathname === '/api/v1/chat/completions';
    } catch (_) {
        return false;
    }
}

function getReasoningRequestConfig(targetApiUrl, reasoningEffort = 'auto', model = '') {
    if (!isOpenRouterChatCompletionsUrl(targetApiUrl)) return {};

    let normalizedEffort = typeof reasoningEffort === 'string'
        ? reasoningEffort.toLowerCase()
        : 'auto';

    // These models answer an error when reasoning is switched off, so
    // "Off" is quietly sent as "Low" for them. A suffix such as ":online"
    // or ":free" names the same model.
    const baseModel = String(model || '').toLowerCase().replace(/:[^/]*$/, '');
    if (normalizedEffort === 'none' && REASONING_REQUIRED_MODELS.has(baseModel)) {
        normalizedEffort = 'low';
    }

    if (OPENROUTER_REASONING_EFFORTS.has(normalizedEffort)) {
        return {
            reasoning: {
                effort: normalizedEffort,
                exclude: false
            }
        };
    }

    // With automatic effort, let the model/provider choose its normal amount
    // of reasoning. Returned traces remain visible by default.
    return {};
}



const REPLY_LENGTH_TARGETS = Object.freeze({
    short: Object.freeze({ words: '50 words', verbosity: 'low' }),
    medium: Object.freeze({ words: '100 words', verbosity: 'medium' }),
    long: Object.freeze({ words: '200 words', verbosity: 'high' }),
    verylong: Object.freeze({ words: '500 words', verbosity: 'high' })
});

function getReplyLengthInstruction(value) {
    const target = REPLY_LENGTH_TARGETS[value];
    if (!target) return '';

    return `--- TARGET REPLY LENGTH ---
Aim for ${target.words} in this reply. The amount of words is an approximate target and a few words more or less are acceptable if needed. Keep all content useful: do not pad, repeat, mention the target, or summarize these instructions.

`;
}

function getReplyLengthVerbosityConfig(targetApiUrl, value) {
    const verbosity = REPLY_LENGTH_TARGETS[value]?.verbosity;
    return isOpenRouterChatCompletionsUrl(targetApiUrl) && verbosity
        ? { verbosity }
        : {};
}

function getContinuationInstruction(value) {
    const lengthRule = REPLY_LENGTH_TARGETS[value]
        ? 'After repairing the ending, continue with fresh material at the selected target reply length.'
        : 'After repairing the ending, add one concise paragraph of fresh material.';

    return `Continue the preceding assistant message directly from its exact final character.

Continuation contract:
- Return only continuation text: no preface, label, summary, restart, or quotation of text that is already complete.
- Inspect the ending before writing. If it stops inside a word, begin with that entire intended word from its first letter. The app will merge the repeated fragment; never insert a space inside the repaired word.
- If it stops inside a sentence, dialogue line, quotation, thought, markdown emphasis, or bracketed phrase, finish that open structure first. Preserve its grammar, punctuation, tense, point of view, speaker, tone, and formatting.
- If the ending is already complete, begin with the next natural sentence or paragraph.
- Do not repeat any complete phrase or sentence from the preceding message.
- ${lengthRule} Move the scene forward with genuinely new action, dialogue, or description after repairing the ending.`;
}

function mergeContinuationText(originalText, continuationText) {
    const original = String(originalText || '');
    let addition = String(continuationText || '').trim();
    if (!original) return addition;
    if (!addition) return original.trim();

    const originalEndTrimmed = original.trimEnd();
    const trailingWord = originalEndTrimmed.match(/([\p{L}\p{N}'\u2019-]+)$/u)?.[1] || '';
    const leadingWord = addition.match(/^([\p{L}\p{N}'\u2019-]+)/u)?.[1] || '';

    // The prompt asks the model to repeat a word in full when the old response
    // stops mid-word. Replace the partial tail with that full word.
    if (
        trailingWord.length >= 2
        && leadingWord.length > trailingWord.length
        && leadingWord.toLocaleLowerCase().startsWith(trailingWord.toLocaleLowerCase())
    ) {
        const withoutPartialWord = originalEndTrimmed.slice(0, -trailingWord.length);
        return (withoutPartialWord + addition).trim();
    }

    // Remove a repeated tail if a provider restarts with the last phrase despite
    // the prompt. Longer overlaps are checked first to preserve new content.
    const originalLower = originalEndTrimmed.toLocaleLowerCase();
    const additionLower = addition.toLocaleLowerCase();
    const maxOverlap = Math.min(originalEndTrimmed.length, addition.length, 240);
    for (let length = maxOverlap; length >= 8; length--) {
        if (originalLower.slice(-length) === additionLower.slice(0, length)) {
            addition = addition.slice(length).trimStart();
            break;
        }
    }
    if (!addition) return originalEndTrimmed;

    const straightQuoteCount = (originalEndTrimmed.match(/"/g) || []).length;
    if (
        straightQuoteCount % 2 === 1
        && (addition.startsWith('"') || originalEndTrimmed.endsWith('"'))
    ) {
        return (originalEndTrimmed + addition).trim();
    }
    for (const marker of ['```', '`', '**', '__', '*', '_']) {
        if (addition.startsWith(marker)) {
            const markerCount = originalEndTrimmed.split(marker).length - 1;
            if (markerCount % 2 === 1) {
                return (originalEndTrimmed + addition).trim();
            }
        }
    }

    if (/\s$/.test(original) || /^[,.;:!?\u0027\u2026\)\]\}\u00BB\u201D\u2019]/u.test(addition)) {
        return (original + addition).trim();
    }
    if (/[\(\[\{\u00AB\u201C\u2018\u2014-]$/u.test(originalEndTrimmed)) {
        return (originalEndTrimmed + addition).trim();
    }
    return `${originalEndTrimmed} ${addition}`.trim();
}

const defaultSettings = {
        fontSize: '18',
        temperature: '0.70',
        model: resolveDefaultModelId(availableModels),
        mainTextColor: '#FFFFFF',
        dialogueColor: '#ffd952',
        userBubbleColor: '#141414',
        userBubbleOpacity: '0.7',
        aiBubbleColor: '#141414',
        aiBubbleOpacity: '0.7',
        messageSpacing: '50',
        soundEnabled: 'true',
        mutedSounds: '',
        reasoningEffort: 'low',
        replyOptionsEnabled: 'true',
        blur: '5',
        avatarSize: '200',
        ttsEnabled: 'false',
        ttsVoiceURI: '',
        replyLength: 'default',
        imageGenEnabled: 'true',
        imageGenProvider: 'pollinations',
        imageGenModel: 'google/gemini-3.1-flash-lite-image',
        autoSummarize: 'false',
        autoAtmosphere: 'false',
    };

    let audioCtx;
    let autoSummarizeEnabled = false;
    let autoAtmosphereEnabled = false;
    // What the provider reported for every request since the app was opened.
    // Each chat keeps its own running total in chat.costUsd.
    let sessionCostUsd = 0;
    // "Let Them Talk": characters taking turns without the user.
    const autoPlayState = { running: false, stopRequested: false, chatId: null };
    let soundEnabled = true;
    // Ids of single sound effects the user switched off.
    let mutedSounds = new Set();
    let reasoningEffort = 'low';
    let replyOptionsEnabled = true;
    let imageGenEnabled = true;
    let imageGenProvider = 'pollinations';
    let imageGenModel = 'google/gemini-3.1-flash-lite-image';
    let ttsEnabled = false;
    let ttsCurrentVoiceURI = '';
    let replyLength = 'default';
    let replyOptionsLoading = false;
    let pendingReplyOptions = null;
    let replyOptionsReqId = 0;
    // Aborts the suggestion round still in flight, so a reply the user has
    // already moved past cannot arrive over a newer one.
    let replyOptionsController = null;
    // The reply the current round was asked for, so a failed round is not
    // repeated every time the message box takes focus.
    let replyOptionsForMessageId = null;
    let suggestionModelId = null;
    let characters = {};
    let currentCharacterId = null;
    let tempUploadedImages = {
  avatar: null,
  background: null,
  personaAvatar: null
};
    // Working copy of the open card's gallery — written back on save.
    let editorGallery = [];
    let currentChatId = null;
    let worldCharSelectedIds = new Set();
    let worldCharPickerTempIds = new Set();
    let activeGroupParticipantId = null;
    // Chat group currently opened in the chat list (null = main, ungrouped list).
    let openChatGroupId = null;
    let personas = {};
    let appSettings = {};
    let currentStreamController = null;
    // True from the moment a reply is requested until it has finished arriving.
    // currentStreamController is not enough on its own: it is created well after
    // the handler starts, and the handler focuses the message box before that,
    // which used to kick off reply suggestions against the previous message.
    let chatTurnInProgress = false;
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
    const newChatGroupBtn = document.getElementById('new-chat-group-btn');
    const chatListGroupActions = document.getElementById('chat-list-group-actions');
    const chatGroupBar = document.getElementById('chat-group-bar');
    const chatGroupBarName = document.getElementById('chat-group-bar-name');
    const exitChatGroupBtn = document.getElementById('exit-chat-group-btn');
    const moveChatModal = document.getElementById('move-chat-modal');
    const moveChatModalSubtitle = document.getElementById('move-chat-modal-subtitle');
    const moveChatGroupList = document.getElementById('move-chat-group-list');
    const cancelMoveChatBtn = document.getElementById('cancel-move-chat-btn');
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
    const reasoningEffortSelect = document.getElementById('reasoning-effort-select');
    const replyOptionsToggle = document.getElementById('reply-options-toggle');
    const scrollTopFab = document.getElementById('scroll-top-fab');
    const deleteCharacterBtnDashboard = document.getElementById('delete-character-btn-dashboard');
    const blurSlider = document.getElementById('blur-slider');
    const blurValue = document.getElementById('blur-value');
    const avatarSizeSlider = document.getElementById('avatar-size-slider');
    const avatarSizeValue = document.getElementById('avatar-size-value');
    const modelSelect = document.getElementById('model-select');
    const suggestionModelSelect = document.getElementById('suggestion-model-select');
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
    // World editor elements
    const cardTypeCharacterRadio = document.getElementById('type-character');
    const cardTypeWorldRadio = document.getElementById('type-world');
    const typeOptionCharacter = document.getElementById('type-option-character');
    const typeOptionWorld = document.getElementById('type-option-world');
    const editorAvatarUrlGroup = document.getElementById('editor-avatar-url-group');
    const worldCharPickerSection = document.getElementById('world-char-picker-section');
    const chatWorldBadge = document.getElementById('chat-world-badge');
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
    let dragSrcEl = null;
    let dragScrollRAF = null;
    let dragScrollDir = 0;
    // Which panel scrolls while a row is being dragged. Two different lists are
    // reorderable now, in two different modals, so this cannot be hardcoded to
    // the app settings panel any more.
    let dragScrollEl = null;
    function updateDragScroll() {
        if (dragScrollDir !== 0 && dragScrollEl) {
            dragScrollEl.scrollTop += dragScrollDir * 10;
            dragScrollRAF = requestAnimationFrame(updateDragScroll);
        } else {
            dragScrollRAF = null;
        }
    }
    document.addEventListener('dragover', (e) => {
        if (!dragSrcEl || !dragScrollEl) return;
        const modalRect = dragScrollEl.getBoundingClientRect();
        if (e.clientY < modalRect.top + 80) {
            dragScrollDir = -1;
        } else if (e.clientY > modalRect.bottom - 80) {
            dragScrollDir = 1;
        } else {
            dragScrollDir = 0;
        }
        if (dragScrollDir !== 0 && !dragScrollRAF) {
            dragScrollRAF = requestAnimationFrame(updateDragScroll);
        }
    });

    /* Drag-to-reorder for one row of a list. Only one drag can be in flight, so
     * the state above stays shared; what differs per list is the container, the
     * row selector and which element scrolls. Drops are refused across lists. */
    function enableRowDragReorder(rowEl, { listEl, handleEl, rowSelector, scrollEl }) {
        if (!rowEl || !listEl || !handleEl) return;

        // Rows are only draggable while the handle is held, so text inside them
        // stays selectable the rest of the time.
        handleEl.addEventListener('mousedown', () => {
            rowEl.setAttribute('draggable', 'true');
        });

        rowEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
            setTimeout(() => rowEl.classList.add('dragging'), 0);
            dragSrcEl = rowEl;
            dragScrollEl = scrollEl || null;
        });

        rowEl.addEventListener('dragend', () => {
            rowEl.removeAttribute('draggable');
            rowEl.classList.remove('dragging');
            document.querySelectorAll(rowSelector).forEach(el => {
                el.classList.remove('drag-over-top', 'drag-over-bottom');
            });
            dragSrcEl = null;
            dragScrollEl = null;
            if (dragScrollRAF) { cancelAnimationFrame(dragScrollRAF); dragScrollRAF = null; }
            dragScrollDir = 0;
        });

        rowEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!dragSrcEl || dragSrcEl === rowEl || !listEl.contains(dragSrcEl)) return;
            const rect = rowEl.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            rowEl.classList.remove('drag-over-top', 'drag-over-bottom');
            rowEl.classList.add(e.clientY < midY ? 'drag-over-top' : 'drag-over-bottom');
        });

        rowEl.addEventListener('dragleave', (e) => {
            if (!rowEl.contains(e.relatedTarget)) {
                rowEl.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        rowEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // A row from another list must never land in this one.
            if (!dragSrcEl || dragSrcEl === rowEl || !listEl.contains(dragSrcEl)) return;
            rowEl.classList.remove('drag-over-top', 'drag-over-bottom');
            const rect = rowEl.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            listEl.insertBefore(dragSrcEl, e.clientY < midY ? rowEl : rowEl.nextSibling);
        });
    }





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



// An alert about something that went wrong, with the error sound.
function showErrorAlert(message) {
    playSound('error');
    showCustomAlert(message);
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



// `pendingSuggestion` lets the dialog open instantly with whatever text is
// already available and improve it later, instead of making the user wait on a
// network round trip before the box even appears. Anything the user types wins.
function showCustomLargePrompt(message, placeholder = '', defaultValue = '', rows = 6, pendingSuggestion = null) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'custom-alert-overlay';

        const modal = document.createElement('div');
        modal.className = 'custom-alert-modal';
        modal.style.maxWidth = '520px';

        const messageP = document.createElement('p');
        messageP.textContent = message;
        messageP.style.cssText = 'margin:0 0 10px;font-size:0.95em;';

        const textarea = document.createElement('textarea');
        textarea.placeholder = placeholder;
        textarea.value = defaultValue;
        textarea.rows = rows;
        textarea.style.cssText = 'width:100%;background:#2a2a3a;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:9px 10px;font-size:0.9em;margin-bottom:12px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.5;';

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
        modal.appendChild(textarea);

        let refiningNote = null;
        if (pendingSuggestion) {
            refiningNote = document.createElement('div');
            refiningNote.className = 'prompt-refining-note';
            const spinner = document.createElement('span');
            spinner.className = 'btn-spinner';
            refiningNote.appendChild(spinner);
            refiningNote.appendChild(document.createTextNode(
                'Refining this into an image prompt… you can edit or send it now.'
            ));
            modal.appendChild(refiningNote);
        }

        modal.appendChild(buttonContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        textarea.focus();

        // Once the user touches the box, a late suggestion must not overwrite
        // their work; it only fills in text they never changed.
        let userEdited = false;
        textarea.addEventListener('input', () => { userEdited = true; });

        if (pendingSuggestion) {
            Promise.resolve(pendingSuggestion).then(better => {
                if (refiningNote) refiningNote.remove();
                if (!overlay.isConnected || userEdited) return;
                const cleaned = String(better || '').trim();
                if (cleaned && cleaned !== textarea.value) {
                    textarea.value = cleaned;
                }
            }).catch(() => {
                if (refiningNote) refiningNote.remove();
            });
        }

        const confirm = () => {
            overlay.remove();
            resolve(textarea.value);
        };
        const cancel = () => {
            overlay.remove();
            resolve(null);
        };

        okButton.addEventListener('click', confirm);
        cancelButton.addEventListener('click', cancel);
        textarea.addEventListener('keydown', (e) => {
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
    if (dataView.byteLength < pngSignature.length) {
        console.error("Not a valid PNG file.");
        return null;
    }
    for (let i = 0; i < pngSignature.length; i++) {
        if (dataView.getUint8(i) !== pngSignature[i]) {
            console.error("Not a valid PNG file.");
            return null;
        }
    }

    const parsePayload = (payload) => {
        try {
            return JSON.parse(payload);
        } catch (_) {
            try {
                const binaryString = atob(payload);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
                return JSON.parse(new TextDecoder('utf-8').decode(bytes));
            } catch (e) {
                console.error("Failed to decode or parse character data from PNG:", e);
                return null;
            }
        }
    };

    // V2 cards carry "chara"; V3 cards add "ccv3" and usually keep "chara"
    // beside it. "chara" is preferred, "ccv3" is the fallback.
    let v3Payload = null;
    let offset = 8;
    // A chunk header is 8 bytes; a truncated or corrupt length must end the
    // walk instead of reading past the end of the buffer.
    while (offset + 8 <= dataView.byteLength) {
        const length = dataView.getUint32(offset);
        if (offset + 12 + length > dataView.byteLength) break;
        const type = String.fromCharCode(
            dataView.getUint8(offset + 4),
            dataView.getUint8(offset + 5),
            dataView.getUint8(offset + 6),
            dataView.getUint8(offset + 7)
        );

        if (type === 'tEXt') {
            const chunkData = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer, offset + 8, length));
            if (chunkData.startsWith('chara\0')) return parsePayload(chunkData.substring(6));
            if (chunkData.startsWith('ccv3\0') && v3Payload === null) v3Payload = chunkData.substring(5);
        }
        if (type === 'IEND') break;
        offset += 12 + length;
    }
    return v3Payload !== null ? parsePayload(v3Payload) : null;
}



// Card lorebooks arrive in several shapes: a V3 `character_book` object with an
// entries array, a bare string, or one of the older flat fields. Everything
// funnels through here into { pieces, entries } - `pieces` feeds the always-on
// lorebook text, `entries` the keyword-triggered list the editor can drive.
function extractCardLorebook(data) {
  const pieces = [];
  const entries = [];
  const push = (value) => {
    const t = typeof value === "string" ? value.trim() : "";
    if (t) pieces.push(t);
  };

  const book = data.character_book || data.embedded_lorebook || null;
  if (typeof book === "string") push(book);

  const list = Array.isArray(book) ? book
             : (book && Array.isArray(book.entries) ? book.entries : null);

  if (list) {
    list.forEach((e) => {
      if (!e) return;
      const rawKeys = Array.isArray(e.keys) ? e.keys
                    : Array.isArray(e.key) ? e.key
                    : (e.keys || e.key || e.keyword || "");
      const keywords = (Array.isArray(rawKeys) ? rawKeys.join(", ") : String(rawKeys || "")).trim();
      const content = String(e.content || e.value || e.entry || "").trim();
      if (!content) return;

      entries.push({ keywords: keywords, text: content });
      pieces.push([keywords ? `[${keywords}]` : "", content].filter(Boolean).join("\n").trim());
    });
  }

  push(data.lorebook);
  push(data.lore);
  push(data.world_scenario);

  return { pieces: pieces, entries: entries };
}


function convertExternalCardToCCC(externalCard, imageBlob = null) {
  const data = externalCard.data || externalCard;
  const txt = (v) => (typeof v === "string" ? v.trim() : "");

  // A section is only written when it has something in it, so a card with no
  // example dialogue no longer imports with an empty "--- EXAMPLE MESSAGES ---"
  // heading dangling off the end of its description.
  const joinSections = (sections) => sections
    .filter(s => txt(s.body))
    .map(s => (s.header ? `${s.header}\n${txt(s.body)}` : txt(s.body)))
    .join("\n\n")
    .trim();

  const tagline     = txt(data.card_description || data.tagline);
  const personality = txt(data.personality || data.tavern_personality);
  const description = txt(data.description);
  const mesExample  = txt(data.mes_example || data.example_dialogs);

  const allDescriptions = joinSections([
    { header: "", body: tagline },
    { header: "--- CHARACTER DESCRIPTION ---", body: [personality, description].filter(Boolean).join("\n\n") },
    { header: "--- EXAMPLE MESSAGES ---", body: mesExample }
  ]);

  // Creator notes are deliberately not imported. They are a message from the
  // card's author to whoever downloads it - changelogs, credits, "use this
  // preset", links - and not anything the character is. In the description
  // they read as part of the persona, in the lorebook as world facts. Both
  // are wrong, so they are left behind.

  const book = extractCardLorebook(data);
  const flatLore = book.pieces.filter(p => p && p !== tagline).join("\n\n").trim();

  // Which lore mode the card actually wants. Always-on lore is prepended to
  // every prompt, which is fine for a few paragraphs and ruinous for a real
  // lorebook - cards routinely carry 150+ entries running to hundreds of KB.
  // When most entries came with trigger keywords, that is the author saying
  // "inject these on demand", so the card opens keyword-triggered and the bulk
  // lives in loreEntries only. With no keywords nothing would ever fire, so
  // those stay always-on. Either way the entries are filled in, so switching
  // the toggle in the editor just works.
  const keyed = book.entries.filter(e => e.keywords).length;
  const useKeyword = book.entries.length > 0 && keyed >= book.entries.length / 2;
  const allLore = useKeyword ? "" : flatLore;

  const allScenarios = [];
  const mainScenarioText = [txt(data.scenario), txt(data.first_mes)].filter(Boolean).join("\n\n").trim();
  if (mainScenarioText) {
    allScenarios.push({ name: 'Main Greeting', greeting: mainScenarioText, memories: '' });
  }
  if (Array.isArray(data.alternate_greetings)) {
    data.alternate_greetings.forEach((greeting, index) => {
      const t = txt(greeting);
      if (t) allScenarios.push({ name: `Alternate Greeting ${index + 1}`, greeting: t, memories: '' });
    });
  }

  // V2 cards conventionally write the literal string "none" when they carry no
  // picture, which would otherwise be handed to an <img> as a src and render
  // as a broken image.
  const cardAvatar = /^(data:|https?:|blob:)/i.test(txt(data.avatar)) ? txt(data.avatar) : "";

  const newChar = {
    id: 'char-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    name: txt(data.name) || 'Unnamed Import',
    chatName: txt(data.nickname) || txt(data.name) || '',
    avatar: imageBlob || cardAvatar,
    background: '',
    gallery: [],
    description: allDescriptions,
    lore: allLore,
    loreMode: useKeyword ? 'keyword' : 'flat',
    loreEntries: book.entries,
    tags: (Array.isArray(data.tags) ? data.tags.join(', ') : ''),
    instructions: txt(data.system_prompt),
    reminder: txt(data.post_history_instructions),
    narratorReminder: '',
    musicUrl: '',
    scenarios: allScenarios,
    type: 'character',
    characterIds: [],
    chats: {}
  };
  return newChar;
}



  function adjustFontSizeToFit(element) {
    const MIN_FONT_SIZE = 8;
    const inner = element.querySelector('.card-title-lines') || element.querySelector('span') || element;

    element.style.fontSize = '';

    // Element has no layout (inside a hidden/collapsed parent) — skip
    if (element.clientHeight <= 0) return;

    const style = window.getComputedStyle(element);
    const paddingV = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const maxHeight = element.clientHeight - paddingV;

    const startSize = parseFloat(style.fontSize);
    if (inner.scrollHeight <= maxHeight || !(startSize > MIN_FONT_SIZE)) return;

    // The same sizes a one-pixel step down would try (startSize - 1,
    // startSize - 2, ... for at most `steps` steps), but found by halving:
    // every probe forces a layout, and across a list of cards that added up.
    const steps = Math.ceil(startSize - MIN_FONT_SIZE);
    let lo = 1;
    let hi = steps;
    let best = steps;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      element.style.fontSize = (startSize - mid) + 'px';
      if (inner.scrollHeight <= maxHeight) {
        best = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    element.style.fontSize = (startSize - best) + 'px';
  }



    function getImageUrl(source) {
  if (source instanceof Blob) {
    return URL.createObjectURL(source);
  }
  return source || '';
}

// A CSS url() value built from a stored or imported image address. Quoted and
// escaped, so a quote or backslash inside the address cannot end the url()
// early and spill into the rest of the declaration.
function cssUrl(url) {
    const escaped = String(url || '').replace(/["\\\n\r\f]/g, ch => '\\' + ch.charCodeAt(0).toString(16) + ' ');
    return `url("${escaped}")`;
}

// Card backdrop (blurred side fill): desktop keeps the full-res background
// feeding the live ::before blur layer. On touch devices that's one GPU
// filter surface per card — too much for mobile GPUs — so there the avatar
// is pre-blurred once into a tiny canvas and the upscaled result is used
// instead. Keyed by source identity, so an edited avatar gets a fresh backdrop.
const isCoarseTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const cardBackdropCache = new Map();

function setBlurredCardBackdrop(container, source, imageUrl) {
    if (!isCoarseTouchDevice) {
        container.style.backgroundImage = cssUrl(imageUrl);
        return;
    }
    const cached = cardBackdropCache.get(source);
    if (cached) {
        container.style.backgroundImage = cssUrl(cached);
        return;
    }
    const useLiveBlurFallback = () => {
        container.style.backgroundImage = cssUrl(imageUrl);
        container.classList.add('has-live-blur');
    };
    const img = new Image();
    if (/^https?:/i.test(imageUrl)) img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            const scale = Math.min(1, 32 / Math.max(img.naturalWidth, img.naturalHeight, 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            cardBackdropCache.set(source, dataUrl);
            container.style.backgroundImage = cssUrl(dataUrl);
        } catch (err) {
            useLiveBlurFallback();
        }
    };
    img.onerror = useLiveBlurFallback;
    img.src = imageUrl;
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
    const userName = persona ? (persona.chatName || persona.name) : '';
    if (userName) {
        return (s || '').replace(/{{\s*user\s*}}/g, userName);
    }
    return s || '';
}

// Returns the lore text to inject for a character.
// 'flat' mode (default, legacy): the whole `lore` string, always included.
// 'keyword' mode: only the loreEntries whose trigger keywords appear in `scanText` (recent messages).
function getLoreText(character, scanText) {
    if (!character) return '';
    if ((character.loreMode || 'flat') === 'keyword') {
        if (!Array.isArray(character.loreEntries) || character.loreEntries.length === 0) return '';
        const hay = (scanText || '').toLowerCase();
        return character.loreEntries
            .filter(e => (e.keywords || '').split(',').some(k => {
                const kw = k.trim().toLowerCase();
                return kw && hay.includes(kw);
            }))
            .map(e => (e.text || '').trim())
            .filter(Boolean)
            .join('\n\n');
    }
    return (character.lore || '').trim();
}

// Card text (description, lore, world sheet) is written with {{char}} and
// {{user}} so one card works for any name. The request builders send it to
// the model, so the names are filled in there, exactly as they already were
// for instructions and reminders.
function fillPromptPlaceholders(s, charName, persona) {
    const withChar = charName ? applyCharPlaceholder(s, charName) : (s || '');
    return applyUserPlaceholder(withChar, persona);
}

// The notices the app writes into a reply bubble when a request fails. They
// are for the user to read, not part of the story, so they are kept out of
// every prompt. New notices carry `notice: true`; older chats only have the
// text, so the known openings are recognised as well.
const CHAT_NOTICE_PREFIXES = [
    'AI Model did not respond to the request.',
    'An unexpected error occurred. Please try regenerating the response',
    'Could not connect to the AI provider.',
    'Connecting to AI Model - Please wait',
    'The AI provider may be experiencing issues',
    'The selected AI Model experiences heavy traffic'
];

const REGENERATE_NO_RESPONSE_NOTICE = `AI Model did not respond to the request. Please try the following steps:

• Re-enter your default API key (or model-specific API key) in the app settings by copy & paste to ensure that it's correct.
• Check the request limits per minute/per day of the provider you're using, especially in free plans. Connection fails when limits are exceeded.
• Try sending a message again later in case the model is overloaded. Also, use other AI models to see if the AI model itself was the problem.
• In some cases your API provider might have a temporary problem. Try another provider/API key to see if your priveder was the problem.
• Check the FAQ section (help button on main screen) for further details to this error.`;

const CONTINUE_NO_RESPONSE_NOTICE = REGENERATE_NO_RESPONSE_NOTICE.replace('your priveder was', 'your provider was');

function isChatNoticeVariant(variant) {
    if (!variant) return false;
    if (variant.notice === true) return true;
    const text = typeof variant.main === 'string' ? variant.main.trim() : '';
    return CHAT_NOTICE_PREFIXES.some(prefix => text.startsWith(prefix));
}

function isChatNoticeMessage(message) {
    return !!message && message.sender === 'ai'
        && isChatNoticeVariant(message.variations?.[message.activeVariant]);
}

// A message the user hid from the AI stays in the chat for them to read, but
// is never sent - not in replies, summaries, suggestions or image prompts.
function isHiddenFromAI(message) {
    return !!message && message.hiddenFromAI === true;
}

// History as the model should see it: without the app's own notices, and
// without anything the user hid from it.
function historyForPrompt(history) {
    return (history || []).filter(msg => !isChatNoticeMessage(msg) && !isHiddenFromAI(msg));
}

/* ===========================================================================
 * DICE ROLLS
 * ===========================================================================
 * "/roll" at the start of a message rolls real dice: "/roll" alone is a d20,
 * "/roll 2d6+3" anything else. Text after the dice is sent on as the user's
 * action, with the result in front of it so the model plays the outcome. A
 * bare roll is only posted, so the user can decide what to do with it.
 * ======================================================================== */

const DICE_MAX_COUNT = 100;
const DICE_MAX_SIDES = 1000;

function parseDiceCommand(input) {
    const match = String(input || '').trim()
        .match(/^\/roll\b(?:\s+(\d{0,3})d(\d{1,4})(?:\s*([+-])\s*(\d{1,5}))?(?=\s|$))?\s*([\s\S]*)$/i);
    if (!match) return null;
    const hasDice = match[2] !== undefined;
    const count = hasDice ? parseInt(match[1] || '1', 10) : 1;
    const sides = hasDice ? parseInt(match[2], 10) : 20;
    const modifier = match[3] ? (match[3] === '-' ? -1 : 1) * parseInt(match[4], 10) : 0;
    if (count < 1 || count > DICE_MAX_COUNT || sides < 2 || sides > DICE_MAX_SIDES) {
        return { error: `Dice go from 1 to ${DICE_MAX_COUNT} dice with 2 to ${DICE_MAX_SIDES} sides, e.g. /roll 2d6+3.` };
    }
    return { count, sides, modifier, text: (match[5] || '').trim() };
}

function diceRandom() {
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoApi?.getRandomValues) return cryptoApi.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    return Math.random();
}

function rollDice(spec, random = diceRandom) {
    const rolls = Array.from({ length: spec.count }, () => 1 + Math.floor(random() * spec.sides));
    return { rolls, total: rolls.reduce((sum, roll) => sum + roll, 0) + spec.modifier };
}

function formatDiceResult(spec, result) {
    const sign = spec.modifier > 0 ? '+' : '-';
    const notation = `${spec.count}d${spec.sides}${spec.modifier ? `${sign}${Math.abs(spec.modifier)}` : ''}`;
    const parts = spec.count > 1 || spec.modifier
        ? ` (${result.rolls.join(' + ')}${spec.modifier ? ` ${sign} ${Math.abs(spec.modifier)}` : ''})`
        : '';
    let flourish = '';
    if (spec.count === 1 && spec.sides === 20) {
        if (result.rolls[0] === 20) flourish = ' - natural 20!';
        else if (result.rolls[0] === 1) flourish = ' - natural 1!';
    }
    return `🎲 Rolled ${notation}: ${result.total}${parts}${flourish}`;
}

/* ===========================================================================
 * MILESTONES
 * ======================================================================== */

const MESSAGE_MILESTONES = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const WORD_MILESTONES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];

// Milestone keys ('m100', 'w50000') reached by the given counts, lowest first.
function reachedMilestones(messageCount, wordCount) {
    return [
        ...MESSAGE_MILESTONES.filter(n => messageCount >= n).map(n => `m${n}`),
        ...WORD_MILESTONES.filter(n => wordCount >= n).map(n => `w${n}`)
    ];
}

function countWords(text) {
    const trimmed = String(text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Pacing for the chat request retries. A rate limit is waited out with a
// growing pause (or the one the provider asks for) instead of a request every
// second, and a reply that comes back empty is only asked for again a couple
// of times, since every attempt is billed.
const CHAT_RATE_LIMIT_PATIENCE_MS = 90000;
const CHAT_MAX_EMPTY_ATTEMPTS = 3;
const CHAT_MAX_NETWORK_ATTEMPTS = 4;

function chatRetryDelayMs(retryNumber, response = null) {
    const header = response?.headers?.get?.('retry-after');
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
        const at = Date.parse(header);
        if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 30000);
    }
    return Math.min(1000 * 2 ** Math.max(0, retryNumber - 1), 8000);
}

// A daily or credit quota does not reset in the next minute, so waiting it out
// only repeats the refusal.
function isHardQuotaError(text) {
    return /per-day|per day|daily|insufficient credits|quota exceeded|credits? (?:exhausted|remaining)/i.test(String(text || ''));
}

// Chrome says "Failed to fetch", Firefox "NetworkError when attempting to fetch
// resource", Safari "Load failed". All three mean the request never got an answer.
function isConnectionFailure(error) {
    const message = String(error?.message || '');
    return error?.name === 'TypeError'
        && /failed to fetch|networkerror|load failed|network connection was lost/i.test(message);
}

function isTemporaryChatError(error) {
    const message = String(error?.message || '');
    return isConnectionFailure(error) || message.includes('maximum capacity');
}

// The provider's own explanation, pulled out of an error body such as
// {"error":{"message":"User not found."}}, so a failure can say what went wrong.
function describeProviderError(error) {
    // Only a plain Error carries a provider's answer (the request paths throw
    // the response body that way); a TypeError or the like is the app's own.
    if (!error || error.name !== 'Error') return '';
    const raw = String(error.message || '').trim();
    if (!raw) return '';
    let detail = raw;
    try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message || parsed?.message || parsed?.error || raw;
        if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch (_) {}
    // A gateway error page arrives as HTML; only its words are worth showing.
    detail = detail.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
    detail = detail.replace(/\s+/g, ' ').trim();
    return detail.length > 300 ? detail.slice(0, 297) + '…' : detail;
}

function withProviderDetail(message, error) {
    const detail = describeProviderError(error);
    return detail ? `${message}\n\nProvider message: ${detail}` : message;
}

// A pause between retries that ends early when the user presses Stop, so a
// long rate-limit wait never keeps a cancelled request alive.
function waitForRetry(ms, signal) {
    return new Promise(resolve => {
        if (signal?.aborted) { resolve(); return; }
        const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal?.addEventListener('abort', done);
    });
}

// "Connecting…", "heavy traffic…" and the like are shown in the waiting bubble
// only. Written into the message itself they were saved, and later sent to the
// model as if the character had said them.
function showBubbleStatus(messageId, text) {
    const el = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"] .main-content`);
    if (!el) return;
    setBubbleLoading(el, false);
    el.innerHTML = formatSubString(text);
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
        const numCtxRaw = entry.querySelector('.model-num-ctx-input').value;
        const numCtx = numCtxRaw !== '' ? parseInt(numCtxRaw, 10) : null;

        if (name && id) {
            models.push({ name, id, targetApiUrl, apiKey, instructions, reminder, narratorReminder, numCtx });
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
        availableModels: availableModels.map(m => ({ ...m }))
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

    if (isUntouchedRetiredModelList(appSettings.availableModels)) {
        appSettings = { ...appSettings, availableModels: defaultSettings.availableModels };
        if (db) {
            const writeTransaction = db.transaction(['settings'], 'readwrite');
            writeTransaction.objectStore('settings').put({ key: 'appSettings', value: appSettings });
        }
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
      instructions: m.instructions || '',
      reminder: m.reminder || '',
      narratorReminder: m.narratorReminder || ''
    }));
    await saveAppSettings();
  }
}



    /* ===========================================================================
     * SOUND EFFECTS
     * ===========================================================================
     * Made in the Sound Design Tool (its "Chat App" presets) and shipped as MP3s
     * in sounds/. A standalone file cannot fetch files beside it, so its build
     * puts the same MP3s inline as data URLs in window.CCC_SOUND_DATA.
     * "Sound Effects" in Settings > Features switches them all off, and the
     * list under it switches single ones off.
     * ======================================================================== */
    const SOUND_EFFECTS = [
        { id: 'reply', label: 'Reply arrives' },
        { id: 'send', label: 'Message sent' },
        { id: 'dice-nat20', label: 'Natural 20 roll' },
        { id: 'milestone', label: 'Milestone reached' },
        { id: 'bookmark', label: 'Bookmark added' },
        { id: 'memory', label: 'Memory saved' },
        { id: 'branch', label: 'New branch' },
        { id: 'swap', label: 'Character swap or join' },
        { id: 'error', label: 'Error' },
        { id: 'delete', label: 'Message deleted' },
    ];
    // id -> promise of the decoded AudioBuffer, or of null when it could not load.
    const soundBuffers = new Map();

    function ensureAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return null;
            audioCtx = new AudioContextClass();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        return audioCtx;
    }

    function loadSound(id) {
        if (!audioCtx) return Promise.resolve(null);
        if (!soundBuffers.has(id)) {
            const src = window.CCC_SOUND_DATA?.[id] || `sounds/${id}.mp3`;
            soundBuffers.set(id, fetch(src)
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.arrayBuffer();
                })
                // The callback form, because older Safari has no promise version.
                .then(data => new Promise((resolve, reject) => audioCtx.decodeAudioData(data, resolve, reject)))
                .catch(err => {
                    console.warn(`Sound "${id}" could not be loaded:`, err);
                    soundBuffers.delete(id); // tried again the next time it plays
                    return null;
                }));
        }
        return soundBuffers.get(id);
    }

    function preloadSounds() {
        if (!audioCtx || !soundEnabled) return;
        SOUND_EFFECTS.forEach(sound => { if (!mutedSounds.has(sound.id)) loadSound(sound.id); });
    }

    // delayMs starts the sound later on the audio clock, to meet an animation.
    // preview plays it even when it is switched off (the ▶ buttons in Settings).
    async function playSound(id, { delayMs = 0, preview = false } = {}) {
        if (!preview && (!soundEnabled || mutedSounds.has(id))) return;
        // Browsers allow audio only after the user has interacted with the page.
        const ctx = preview ? ensureAudioContext() : audioCtx;
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const startAt = ctx.currentTime + delayMs / 1000;
        const buffer = await loadSound(id);
        if (!buffer) return;
        // On a very slow first load the moment has passed; better silent than late.
        if (ctx.currentTime - startAt > 1.5) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(Math.max(ctx.currentTime, startAt));
    }

    function syncSoundPicker() {
        document.querySelectorAll('#sound-picker-list input[data-sound]').forEach(box => {
            box.checked = !mutedSounds.has(box.dataset.sound);
        });
        document.getElementById('sound-picker')?.classList.toggle('is-off', !soundEnabled);
    }

    const soundPickerList = document.getElementById('sound-picker-list');
    if (soundPickerList) {
        soundPickerList.innerHTML = SOUND_EFFECTS.map(sound => `
            <div class="sound-picker-row">
                <label><input type="checkbox" data-sound="${sound.id}" checked><span>${sound.label}</span></label>
                <button type="button" class="sound-preview-btn" data-sound="${sound.id}" aria-label="Play ${sound.label}" title="Play">▶</button>
            </div>`).join('');
        soundPickerList.addEventListener('change', event => {
            const box = event.target.closest('input[data-sound]');
            if (!box) return;
            const muted = [...soundPickerList.querySelectorAll('input[data-sound]')]
                .filter(input => !input.checked)
                .map(input => input.dataset.sound)
                .join(',');
            applySetting('mutedSounds', muted);
            saveSettingToDB('mutedSounds', muted).catch(err => console.error('Could not save setting mutedSounds:', err));
            if (box.checked) playSound(box.dataset.sound, { preview: true });
        });
        soundPickerList.addEventListener('click', event => {
            const button = event.target.closest('.sound-preview-btn');
            if (button) playSound(button.dataset.sound, { preview: true });
        });
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
                syncSoundPicker();
                preloadSounds();
                break;
            case 'mutedSounds':
                mutedSounds = new Set(String(value || '').split(',').filter(Boolean));
                syncSoundPicker();
                break;
            case 'reasoningEffort': {
                const supportedEfforts = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
                reasoningEffort = supportedEfforts.includes(value) ? value : 'auto';
                if (reasoningEffortSelect) reasoningEffortSelect.value = reasoningEffort;
                break;
            }
            case 'replyOptionsEnabled':
                replyOptionsEnabled = (value === 'true' || value === true);
                if (!replyOptionsEnabled) cancelReplyOptions();
                break;
            case 'suggestionModelId':
                suggestionModelId = value || null;
                if (suggestionModelSelect) suggestionModelSelect.value = value || '';
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
            case 'ttsEnabled':
                ttsEnabled = (value === 'true' || value === true);
                const ttsToggleEl = document.getElementById('tts-toggle');
                if (ttsToggleEl) ttsToggleEl.checked = ttsEnabled;
                break;
            case 'ttsVoiceURI':
                ttsCurrentVoiceURI = value || '';
                const ttsVoiceSelectEl = document.getElementById('tts-voice-select');
                if (ttsVoiceSelectEl) ttsVoiceSelectEl.value = ttsCurrentVoiceURI;
                break;
            case 'replyLength':
                replyLength = value || 'default';
                const replyLengthSelectEl = document.getElementById('reply-length-select');
                if (replyLengthSelectEl) replyLengthSelectEl.value = replyLength;
                break;
            case 'imageGenEnabled':
                imageGenEnabled = (value === 'true' || value === true);
                // Hide the buttons with a class rather than re-rendering, so
                // the toggle also affects messages that are already on screen.
                document.body.classList.toggle('image-gen-off', !imageGenEnabled);
                break;
            case 'imageGenProvider': {
                imageGenProvider = IMAGE_PROVIDERS[value] ? value : 'pollinations';
                const providerSelectEl = document.getElementById('image-gen-provider-select');
                if (providerSelectEl) providerSelectEl.value = imageGenProvider;
                const modelSettingEl = document.getElementById('image-gen-model-setting');
                if (modelSettingEl) modelSettingEl.classList.toggle('hidden', imageGenProvider !== 'openrouter');
                // Showing or hiding the model row changes the section's height.
                if (typeof refreshOpenAccordionHeight === 'function') refreshOpenAccordionHeight();
                break;
            }
            case 'imageGenModel':
                imageGenModel = value || defaultSettings.imageGenModel;
                break;
            case 'autoSummarize':
                autoSummarizeEnabled = (value === 'true' || value === true);
                break;
            case 'autoAtmosphere': {
                const wasEnabled = autoAtmosphereEnabled;
                autoAtmosphereEnabled = (value === 'true' || value === true);
                if (wasEnabled !== autoAtmosphereEnabled) onAutoAtmosphereToggled();
                break;
            }
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
        reasoningEffort: reasoningEffortSelect,
        replyOptionsEnabled: replyOptionsToggle,
        blur: blurSlider,
        avatarSize: avatarSizeSlider,
        model: modelSelect,
        ttsEnabled: document.getElementById('tts-toggle'),
        ttsVoiceURI: document.getElementById('tts-voice-select'),
        replyLength: document.getElementById('reply-length-select'),
        imageGenEnabled: document.getElementById('image-gen-toggle'),
        imageGenProvider: document.getElementById('image-gen-provider-select'),
        imageGenModel: document.getElementById('image-gen-model-input'),
        autoSummarize: document.getElementById('auto-summarize-toggle'),
        autoAtmosphere: document.getElementById('auto-atmosphere-toggle'),
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

    // The loop above assigns the saved model id blind. If it predates a change
    // to the model list it is no longer one of the options and the selector goes
    // blank, so settle it against what the list actually holds.
    setSelectValueWithFallback(modelSelect, [savedSettings['model'], defaultSettings.model]);

    if (savedSettings['suggestionModelId']) {
        applySetting('suggestionModelId', savedSettings['suggestionModelId']);
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



function getValidActiveGroupParticipantId(chat = characters[currentCharacterId]?.chats?.[currentChatId]) {
    if (!chat?.participants || !activeGroupParticipantId || !chat.participants.includes(activeGroupParticipantId)) {
        return null;
    }
    const selectedCharacter = characters[activeGroupParticipantId];
    return selectedCharacter && selectedCharacter.type !== 'world' ? activeGroupParticipantId : null;
}

function updateChatReplyControls() {
    if (!dialogBtn) return;
    const mainCharacter = characters[currentCharacterId];
    const chat = mainCharacter?.chats?.[currentChatId];
    const selectedCharacterId = getValidActiveGroupParticipantId(chat);
    const hideCharacterButton = mainCharacter?.type === 'world' && !selectedCharacterId;

    dialogBtn.classList.toggle('hidden', hideCharacterButton);
    dialogBtn.setAttribute('aria-hidden', hideCharacterButton ? 'true' : 'false');

    if (hideCharacterButton) {
        dialogBtn.title = 'Select a character tag to request a character reply';
    } else if (selectedCharacterId) {
        const selectedCharacter = characters[selectedCharacterId];
        dialogBtn.title = `Request a reply as ${selectedCharacter.chatName || selectedCharacter.name}`;
    } else {
        dialogBtn.title = 'Request a reply from the character';
    }
}

function getNarratorMetaInstruction() {
    return `[SYSTEM META-INSTRUCTION: You are solely the scene narrator, not a character in the scene.
Respond only with omniscient, third-person narration. Never adopt the identity or first-person voice of the user, an established/selectable card character, or an incidental NPC.
Do not write direct dialogue for the user or any established/selectable card character. You may narrate their observable actions and reactions when supported by the conversation and scene context.
You may—and whenever it makes the scene more vivid, should—create and voice incidental third-party NPCs such as witnesses, bystanders, guards, strangers, or shopkeepers. Keep their dialogue embedded within the narration, and never turn an incidental NPC into the narrator's identity.
Do not prefix the response with a narrator label such as Narrator:.]\n\n`;
}

// Once a chat has more than one participant, every history line is handed to the
// model prefixed with its speaker's name. That transcript reads as a script the
// model is free to keep writing for everyone in it, so wherever we prefix we also
// have to say which one of those speakers it is. Kept as one helper because the
// send, regenerate and continue paths each build their own prompt and had drifted
// apart: only send said anything at all, and only when a participant was tagged.
function getSpeakerExclusivityInstruction(charName, otherSpeakerNames = []) {
    const name = (typeof charName === 'string' && charName.trim()) ? charName.trim() : 'the character';
    const others = (otherSpeakerNames || []).filter(Boolean);
    const othersLine = others.length > 0
        ? `\n${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} played by someone else. Their lines do not belong in this reply.`
        : '';
    return `[SYSTEM META-INSTRUCTION — SPEAKER LOCK: This reply is written as '${name}' and no one else.
Every word of dialogue in it is spoken by '${name}'. No other character speaks, thinks, or decides anything here.${othersLine}
Never answer on another character's behalf, and never write the user's dialogue or choices.
Describe what ${name} says, does, feels and observes about the others as fully as the scene needs — but never put words in their mouths.
Stop at the end of ${name}'s turn and leave the others room to answer for themselves.]

`;
}

// The same rule again, one line long, for the bracket appended to the last user
// message. The system prompt is long and this is the one instruction that has to
// still be in view at the end of it; the model reminder that used to carry the
// rule is user-editable and empty on any model someone added by hand.
function getSpeakerExclusivityReminderLine(charName) {
    const name = (typeof charName === 'string' && charName.trim()) ? charName.trim() : 'the character';
    return `- Only ${name} speaks in this reply. Do not write lines, thoughts, or choices for anyone else.`;
}

// Named so the lock can point at exactly who it is excluding. The world card is
// not a speaker, so it never appears in the list.
function getOtherSpeakerNames(chat, selfId) {
    return (chat?.participants || [])
        .filter(pid => pid !== selfId)
        .map(pid => characters[pid])
        .filter(c => c && c.type !== 'world')
        .map(c => (c.chatName || c.name || '').trim())
        .filter(Boolean);
}

    function handleTextareaEnter(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        storyBtn.click();
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const mainCharacter = characters[currentCharacterId];
        const chat = mainCharacter?.chats?.[currentChatId];
        const worldNeedsNarrator = mainCharacter?.type === 'world' && !getValidActiveGroupParticipantId(chat);
        (worldNeedsNarrator ? storyBtn : dialogBtn).click();
    }
}



function createAvatarWithEffect(imageUrl, size, altText = '') {
  const container = document.createElement('div');
  container.className = 'avatar-container';
  container.style.width = size;
  container.style.height = size;

  if (imageUrl) {
    container.style.backgroundImage = cssUrl(imageUrl);
    container.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText)}" loading="lazy">`;
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
      // The provider address and context length travel with the model, or a
      // restored custom model would quietly point at OpenRouter. API keys are
      // deliberately never exported.
      targetApiUrl: m.targetApiUrl || "",
      numCtx: m.numCtx != null ? m.numCtx : null,
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
  // Revoked late: some browsers are still reading the blob after the click
  // returns, and pulling the URL out from under the save cancels it.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}



  // Merge a v3 backup object into the live collection.
  //
  // Pulled out of handleFileImport so the Character Card Browser bridge below can use
  // the exact same path: a card that arrives over postMessage has to land in
  // the collection identically to one that arrived as a file, or the two ways
  // in drift and only one of them stays tested.
  //
  // Deliberately does not confirm and does not report - the caller owns both,
  // because a file import and a hand-off from the converter have different
  // things to say. Duplicate ids are skipped rather than overwritten, which is
  // what makes re-importing the same card harmless.
  async function mergeBackupIntoCollection(importedData) {
    const importedChars = importedData.characters || {};
    const importedPersonas = importedData.personas || {};
    const importedAppSettings = importedData.appSettings || null;

    let charsAdded = 0, personasAdded = 0, charsSkipped = 0, personasSkipped = 0;
    for (const charId in importedChars) {
        if (!characters[charId]) {
            characters[charId] = importedChars[charId];
            // Used straight away, before any reload, so it has to be split here
            // too and not only in loadCharactersFromDB.
            if (Array.isArray(characters[charId].scenarios)) {
                characters[charId].scenarios = normalizeScenarioList(characters[charId].scenarios);
            }
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
               const importedNumCtx = parseInt(m.numCtx, 10);
               appSettings.availableModels.push({
                   name: String(m.name || ""), id: String(m.id || ""),
                   targetApiUrl: typeof m.targetApiUrl === 'string' ? m.targetApiUrl : "",
                   numCtx: Number.isFinite(importedNumCtx) ? importedNumCtx : null,
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

    return {
        charsAdded, charsSkipped, personasAdded, personasSkipped,
        modelsAdded, modelsSkipped, modelsHydrated,
        hadAppSettings: Boolean(importedAppSettings),
    };
  }

  async function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) { return; }

    // Some systems (Android pickers especially) report no type, or a generic
    // one, for a .json file, so the extension decides when the type does not.
    const lowerName = (file.name || '').toLowerCase();
    const isPngFile = file.type === 'image/png' || (!file.type.startsWith('image/') && lowerName.endsWith('.png'));
    const isJsonFile = file.type === 'application/json' || file.type === 'text/json'
        || (!isPngFile && lowerName.endsWith('.json'));

    if (isPngFile) {
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
                showErrorAlert("Error processing the PNG file: " + error.message);
            }
        };
        reader.readAsArrayBuffer(file);
    } 
    
    else if (isJsonFile) {
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
                        showCustomAlert(`Successfully imported "${newCharacter.name}" from JSON Character Card!`);
                    }
                }
                else if (importedData.version === 3 && importedData.characters) {
                    if (await showCustomConfirm("JSON backup file detected. Do you want to merge the imported data with your current collection?")) {
                        const r = await mergeBackupIntoCollection(importedData);
                        showCustomAlert(
    `Import Complete!\n\n` +
    `Added from file: ${r.charsAdded} characters, ${r.personasAdded} personas.\n` +
    `Skipped duplicates: ${r.charsSkipped} characters, ${r.personasSkipped} personas.\n\n` +
    (r.hadAppSettings ? `Models added: ${r.modelsAdded}, skipped: ${r.modelsSkipped}\nPrompts hydrated: ${r.modelsHydrated}` : ``)
);
                    }
                }
                else {
                    showCustomAlert("Unknown or unsupported JSON format.");
                }
            } catch (error) {
                showErrorAlert("Error reading the JSON file: " + error.message);
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

    // Migration: World cards must not carry an in-chat name. Older worlds were saved
    // with chatName "Narrator", which then leaked into prompts (e.g. the mood line and
    // {{char}} substitution) as a named, behaving entity. Strip it so the world narrates
    // anonymously instead of being treated as a character called "Narrator".
    for (const char of Object.values(characters)) {
        if (char.type === 'world' && char.chatName) {
            char.chatName = '';
            await saveSingleCharacterToDB(char);
        }
    }

    // Migration: a scenario used to be one text blob that became the chat's first
    // message. It is now a greeting plus its memories, so `text` becomes
    // `greeting` - nothing is lost. Cards from the card converter still arrive in
    // the old shape, so this has to keep running, not just once.
    for (const char of Object.values(characters)) {
        if (!Array.isArray(char.scenarios) || !char.scenarios.length) continue;
        const before = JSON.stringify(char.scenarios);
        char.scenarios = normalizeScenarioList(char.scenarios);
        if (JSON.stringify(char.scenarios) !== before) {
            await saveSingleCharacterToDB(char);
        }
    }
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

    setSelectValueWithFallback(modelSelect, [previouslySelectedModel, defaultSettings.model]);

    if (suggestionModelSelect) {
        const prevSuggModel = suggestionModelSelect.value;
        suggestionModelSelect.innerHTML = '<option value="">(same as chat model)</option>';
        appSettings.availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            suggestionModelSelect.appendChild(option);
        });
        suggestionModelSelect.value = prevSuggModel || suggestionModelId || '';
    }
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



function formatCardTitle(name) {
    const fullName = String(name || '').trim();
    const seriesMatch = fullName.match(/^(.+?)\s+(\([^()\n]+\))$/);
    const characterName = seriesMatch ? seriesMatch[1].trim() : fullName;
    const seriesName = seriesMatch ? seriesMatch[2] : '';

    // No whitespace between the spans: the chat list header keeps names with
    // real line breaks readable via white-space: pre-line, and inside a flex
    // box that would turn the indentation into an extra blank line.
    return `<span class="card-title-lines">`
        + `<span class="card-title-character">${escapeHtml(characterName)}</span>`
        + (seriesName ? `<span class="card-title-series">${escapeHtml(seriesName)}</span>` : '')
        + `</span>`;
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
            const isWorldFav = character.type === 'world';
            const favImageSource = isWorldFav ? character.background : character.avatar;
            const imageUrl = getImageUrl(favImageSource);
favElement.innerHTML = `
  <div class="avatar-container">
    <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(character.name)}" class="${favImageSource ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
    <div class="placeholder-icon ${favImageSource ? 'hidden' : ''}">${isWorldFav ? '🌍' : '👤'}</div>
</div>
  <span>${escapeHtml(character.name)}</span>
`;

if (favImageSource) {
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
        const isWorldCard = character.type === 'world';
        charElement.classList.add('character-card');
        if (isWorldCard) charElement.classList.add('card--world');
        charElement.dataset.charId = charId;

        const isFavorite = character.isFavorite === true;
        const archiveButtonIcon = character.isArchived
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        const archiveButtonTitle = character.isArchived ? 'Retrieve from the archive' : 'Archive Character';

        const cardImageSource = isWorldCard ? character.background : character.avatar;
        const imageUrl = getImageUrl(cardImageSource);
        const placeholderContent = isWorldCard ? '<div class="world-card-placeholder">🌍</div>' : '<div class="placeholder-icon">👤</div>';
        const worldBadgeHtml = isWorldCard ? `<span class="world-badge">World</span>` : '';
        // Count only characters that still exist, mirroring the chat-participant
        // logic. Stale/duplicate IDs (e.g. left behind after copying a world)
        // must not inflate the count shown on the card.
        const worldCharCount = isWorldCard
            ? new Set((character.characterIds || []).filter(id => characters[id])).size : 0;
        const worldCharCountHtml = isWorldCard && worldCharCount > 0
            ? `<span class="world-char-count">${worldCharCount} character${worldCharCount !== 1 ? 's' : ''}</span>` : '';
        const starSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
        charElement.innerHTML = `
            ${!character.isArchived ? `<button class="favorite-btn ${isFavorite ? 'is-favorite' : ''}" title="Mark as Favorite">${starSvg}</button>` : ''}
            <button class="archive-btn" title="${archiveButtonTitle}">${archiveButtonIcon}</button>
            <div class="card-image-container effect-container">
    ${worldBadgeHtml}
    <img src="${escapeHtml(imageUrl)}" alt="Avatar" class="${cardImageSource ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
    ${cardImageSource ? '' : placeholderContent}
    ${worldCharCountHtml}
</div>
            <div class="card-name-container">
                ${formatCardTitle(character.name)}
            </div>`;

            if (cardImageSource) {
  const imageContainer = charElement.querySelector('.card-image-container');
  setBlurredCardBackdrop(imageContainer, cardImageSource, imageUrl);
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
    chatListScreen.style.backgroundImage = cssUrl(backgroundUrl);
    starsContainer.classList.remove('visible');
  } else {
    chatListScreen.style.backgroundImage = 'none';
    starsContainer.classList.add('visible');
  }

  const avatarImg = document.getElementById('chat-list-avatar');
  const nameH2 = document.getElementById('chat-list-character-name');

  const isWorldChatList = character.type === 'world';
  const dashboardAvatarUrl = getImageUrl(isWorldChatList ? character.background : character.avatar);
const avatarContainer = document.getElementById('chat-list-avatar-container');

avatarImg.onerror = () => {
    avatarContainer.classList.add('hidden');
    chatListAvatarPlaceholder.classList.remove('hidden');
    chatListAvatarPlaceholder.textContent = isWorldChatList ? '🌍' : '👤';
};

if (dashboardAvatarUrl) {
    avatarImg.src = dashboardAvatarUrl;
    smartObjectFit(avatarImg);
    avatarContainer.style.backgroundImage = cssUrl(dashboardAvatarUrl);
    avatarContainer.classList.remove('hidden');
    chatListAvatarPlaceholder.classList.add('hidden');
} else {
    avatarContainer.classList.add('hidden');
    chatListAvatarPlaceholder.classList.remove('hidden');
    chatListAvatarPlaceholder.textContent = isWorldChatList ? '🌍' : '👤';
    avatarContainer.style.backgroundImage = 'none';
}
  nameH2.innerHTML = formatCardTitle(character.name);

  // Use "World" wording on the dashboard buttons for world cards.
  const cardNoun = isWorldChatList ? 'World' : 'Character';
  editCharacterBtn.textContent = `Edit ${cardNoun}`;
  copyCharacterBtn.textContent = `Copy ${cardNoun}`;
  deleteCharacterBtnDashboard.textContent = `Delete ${cardNoun}`;

  // A group belongs to one character, so switching characters always drops
  // back to that character's main chat list.
  if (previousCharacterId !== charId) openChatGroupId = null;
  const chatGroups = getChatGroups(character);
  if (openChatGroupId && !chatGroups[openChatGroupId]) openChatGroupId = null;
  renderChatGroupBar(character);

  chatSessionListDiv.innerHTML = '';
  const allChats = character.chats || {};
  const chatIds = Object.keys(allChats)
    .filter(chatId => getChatGroupId(allChats[chatId]) === openChatGroupId)
    .sort((a, b) => b.localeCompare(a));
  // Groups are flat, so they are only listed on the main level, above the loose chats.
  const groupList = openChatGroupId
    ? []
    : Object.values(chatGroups).sort((a, b) => a.name.localeCompare(b.name));

  groupList.forEach(group => {
    const chatCount = Object.values(allChats).filter(c => getChatGroupId(c) === group.id).length;
    const groupEntry = document.createElement('div');
    groupEntry.className = 'chat-session-entry chat-group-entry';
    groupEntry.innerHTML = `
        <span class="chat-group-name" data-group-id="${escapeHtml(group.id)}" role="button" tabindex="0" title="Open chat group">
          <span class="chat-group-icon" aria-hidden="true">🗂️</span>
          <span class="chat-group-title">${escapeHtml(group.name)}</span>
          <span class="chat-group-badge">Group</span>
          <span class="chat-group-count">${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}</span>
        </span>
        <div class="chat-session-actions">
          <button class="rename-group-btn" data-group-id="${escapeHtml(group.id)}">Rename</button>
          <button class="delete-group-btn" data-group-id="${escapeHtml(group.id)}">Delete</button>
        </div>`;
    chatSessionListDiv.appendChild(groupEntry);
  });

  chatIds.forEach(chatId => {
    const chat = allChats[chatId];
    const chatEntry = document.createElement('div');
    chatEntry.className = 'chat-session-entry';
    chatEntry.innerHTML = `
        <span class="chat-session-name" data-chat-id="${escapeHtml(chatId)}">${escapeHtml(chat.name)}</span>
        <div class="chat-session-actions">
          <button class="move-chat-btn" data-chat-id="${escapeHtml(chatId)}" title="Move this chat to a group">Move</button>
          <button class="rename-chat-btn" data-chat-id="${escapeHtml(chatId)}">Rename</button>
          <button class="delete-chat-btn" data-chat-id="${escapeHtml(chatId)}">Delete</button>
        </div>`;
    chatSessionListDiv.appendChild(chatEntry);
  });

  if (groupList.length === 0 && chatIds.length === 0) {
    chatSessionListDiv.innerHTML = openChatGroupId
      ? '<p style="color:rgb(233, 233, 233);">No chats in this group yet.</p>'
      : '<p style="color:rgb(233, 233, 233);">No chats yet.</p>';
  }

  chatSessionListDiv.querySelectorAll('.chat-session-name').forEach(nameSpan => {
    nameSpan.addEventListener('click', async (e) => {
      await startChat(charId, e.currentTarget.dataset.chatId);
    });
  });
  chatSessionListDiv.querySelectorAll('.chat-group-name').forEach(groupSpan => {
    groupSpan.addEventListener('click', (e) => openChatGroup(charId, e.currentTarget.dataset.groupId));
    groupSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openChatGroup(charId, e.currentTarget.dataset.groupId);
      }
    });
  });
  chatSessionListDiv.querySelectorAll('.move-chat-btn').forEach(button => {
    button.addEventListener('click', (e) => openMoveChatModal(charId, e.currentTarget.dataset.chatId));
  });
  chatSessionListDiv.querySelectorAll('.rename-chat-btn').forEach(button => {
    button.addEventListener('click', (e) => handleRenameChat(charId, e.currentTarget.dataset.chatId));
  });
  chatSessionListDiv.querySelectorAll('.delete-chat-btn').forEach(button => {
    button.addEventListener('click', (e) => handleDeleteChat(charId, e.currentTarget.dataset.chatId));
  });
  chatSessionListDiv.querySelectorAll('.rename-group-btn').forEach(button => {
    button.addEventListener('click', (e) => handleRenameChatGroup(charId, e.currentTarget.dataset.groupId));
  });
  chatSessionListDiv.querySelectorAll('.delete-group-btn').forEach(button => {
    button.addEventListener('click', (e) => handleDeleteChatGroup(charId, e.currentTarget.dataset.groupId));
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
            try { localStorage.removeItem(chatDraftKey(charId, chatId)); } catch (_) {}
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
    contextText += getChatMemories(chat);
    historyForPrompt(chat.history).forEach(msg => {
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

    const lines = [`Estimated Tokens in Context: ~${totalTokens}`];
    const chatCost = Number(chat.costUsd) || 0;
    if (chatCost > 0 || sessionCostUsd > 0) {
        lines.push(`Cost: ${formatUsd(chatCost)} this chat · ${formatUsd(sessionCostUsd)} this session`);
    }
    tokenTooltip.textContent = lines.join('\n');
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
    totalText += document.getElementById('persona-chat-name').value || '';
    totalText += document.getElementById('persona-description').value || '';

    const estimatedTokens = Math.round(totalText.length / 4);
    personaEditorTokenCounter.textContent = `Estimated Tokens: ~${estimatedTokens}`;
}



    
    function updateChatMemoriesButtonState() {
        if (!chatMemoriesBtn) return;
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        const active = !!getChatMemories(chat);
        chatMemoriesBtn.classList.toggle('active', active);
        chatMemoriesBtn.setAttribute('title', active ? 'Chat Memories (active)' : 'Chat Memories');
    }



    // Set when "Auto-summarize Chat" fills the box, and only acted on if the
    // box is then saved.
    let pendingManualSummary = null;

    function closeChatMemoriesModal() {
        if (chatMemoriesModal) {
            chatMemoriesModal.classList.add('hidden');
        }
        pendingManualSummary = null;
    }



    function openChatMemoriesModal() {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat || !chatMemoriesModal || !chatMemoriesTextarea) return;

        // A chat opened for the first time since the Story Line became part of
        // the memories shows the two already joined; saving writes them back as
        // one.
        chatMemoriesTextarea.value = getChatMemories(chat);
        chatMemoriesModal.classList.remove('hidden');
        chatMemoriesTextarea.focus();
        autoResizeTextarea({ target: chatMemoriesTextarea });
        chatMemoriesTextarea.selectionStart = chatMemoriesTextarea.selectionEnd = chatMemoriesTextarea.value.length;
    }



    async function saveChatMemories() {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat) return;

        const previousMemories = getChatMemories(chat);
        chat.memories = (chatMemoriesTextarea?.value || '').trim();
        delete chat.storyLine;
        delete chat.plan;
        // A manual summary that was kept covers the same ground the automatic
        // one would, so the automatic one starts after it.
        if (pendingManualSummary && pendingManualSummary.chat === chat
            && chat.history.some(m => m.id === pendingManualSummary.upToId)) {
            chat.summarizedUpToId = pendingManualSummary.upToId;
        }
        pendingManualSummary = null;
        await saveSingleCharacterToDB(characters[currentCharacterId]);
        updateChatMemoriesButtonState();
        updateTokenCount();
        closeChatMemoriesModal();
        if (chat.memories && chat.memories !== previousMemories) playSound('memory');
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



    // --- CHAT GROUPS ---

    function getChatGroups(character) {
        if (!character) return {};
        if (!character.chatGroups || typeof character.chatGroups !== 'object') {
            character.chatGroups = {};
        }
        return character.chatGroups;
    }

    // Chats created before chat groups existed simply carry no groupId.
    function getChatGroupId(chat) {
        return (chat && chat.groupId) ? chat.groupId : null;
    }

    function renderChatGroupBar(character) {
        const group = openChatGroupId ? getChatGroups(character)[openChatGroupId] : null;
        if (chatGroupBar) chatGroupBar.classList.toggle('hidden', !group);
        if (chatGroupBarName) chatGroupBarName.textContent = group ? group.name : '';
        // Groups do not nest, so hide the create button's whole row while one is open.
        if (chatListGroupActions) chatListGroupActions.classList.toggle('hidden', !!group);
    }

    function scrollChatListToTop() {
        chatListScreen.scrollTop = 0;
        if (chatSessionListDiv) chatSessionListDiv.scrollTop = 0;
    }

    function openChatGroup(charId, groupId) {
        if (!groupId || !getChatGroups(characters[charId])[groupId]) return;
        openChatGroupId = groupId;
        showChatList(charId);
        scrollChatListToTop();
    }

    function exitChatGroup() {
        if (!currentCharacterId) return;
        openChatGroupId = null;
        showChatList(currentCharacterId);
        scrollChatListToTop();
    }

    async function handleCreateChatGroup() {
        if (!currentCharacterId) return;
        const character = characters[currentCharacterId];
        if (!character) return;
        const name = await showCustomPrompt("Enter a name for the new chat group:", "");
        if (!name || name.trim() === "") return;
        const groups = getChatGroups(character);
        const groupId = 'grp-' + Date.now();
        groups[groupId] = { id: groupId, name: name.trim(), createdAt: Date.now() };
        await saveSingleCharacterToDB(character);
        showChatList(currentCharacterId);
    }

    async function handleRenameChatGroup(charId, groupId) {
        const character = characters[charId];
        const group = getChatGroups(character)[groupId];
        if (!group) return;
        const newName = await showCustomPrompt("Enter a new name for the chat group:", group.name);
        if (newName && newName.trim() !== "") {
            group.name = newName.trim();
            await saveSingleCharacterToDB(character);
            showChatList(charId);
        }
    }

    async function handleDeleteChatGroup(charId, groupId) {
        const character = characters[charId];
        const group = getChatGroups(character)[groupId];
        if (!group) return;
        const chats = character.chats || {};
        const containedIds = Object.keys(chats).filter(id => getChatGroupId(chats[id]) === groupId);
        // Deleting a group never deletes chats - they fall back to the main list.
        const message = containedIds.length > 0
            ? `Are you sure you want to delete the chat group "${group.name}"? Its ${containedIds.length} chat(s) will be kept and moved back to the main chat list.`
            : `Are you sure you want to delete the chat group "${group.name}"?`;
        if (!await showCustomConfirm(message, true)) return;
        containedIds.forEach(id => { chats[id].groupId = null; });
        delete character.chatGroups[groupId];
        if (openChatGroupId === groupId) openChatGroupId = null;
        await saveSingleCharacterToDB(character);
        showChatList(charId);
    }

    function closeMoveChatModal() {
        if (moveChatModal) moveChatModal.classList.add('hidden');
    }

    function openMoveChatModal(charId, chatId) {
        const character = characters[charId];
        const chat = character && character.chats ? character.chats[chatId] : null;
        if (!chat || !moveChatModal || !moveChatGroupList) return;

        const groups = getChatGroups(character);
        const currentGroupId = getChatGroupId(chat);

        if (moveChatModalSubtitle) {
            moveChatModalSubtitle.textContent = `Choose where "${chat.name}" should be filed.`;
        }

        const targets = [{ id: null, name: 'Main Chat List', icon: '💬' }].concat(
            Object.values(groups)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(g => ({ id: g.id, name: g.name, icon: '🗂️' }))
        );

        moveChatGroupList.innerHTML = '';
        targets.forEach(target => {
            const isCurrent = target.id === currentGroupId;
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'participant-option-btn move-chat-option-btn' + (isCurrent ? ' is-current' : '');
            option.disabled = isCurrent;
            option.innerHTML = `
                <span class="move-chat-option-icon" aria-hidden="true">${target.icon}</span>
                <span class="move-chat-option-name"></span>
                ${isCurrent ? '<span class="move-chat-option-current">Current</span>' : ''}`;
            option.querySelector('.move-chat-option-name').textContent = target.name;
            if (!isCurrent) {
                option.addEventListener('click', () => moveChatToGroup(charId, chatId, target.id));
            }
            moveChatGroupList.appendChild(option);
        });

        if (Object.keys(groups).length === 0) {
            const hint = document.createElement('p');
            hint.className = 'move-chat-empty-hint';
            hint.textContent = 'No chat groups yet - create one with the "New Group" button above the chat list.';
            moveChatGroupList.appendChild(hint);
        }

        moveChatModal.classList.remove('hidden');
    }

    async function moveChatToGroup(charId, chatId, groupId) {
        const character = characters[charId];
        const chat = character && character.chats ? character.chats[chatId] : null;
        if (!chat) return;
        if (groupId && !getChatGroups(character)[groupId]) return;
        chat.groupId = groupId || null;
        closeMoveChatModal();
        await saveSingleCharacterToDB(character);
        showChatList(charId);
    }



        function showMainScreen() {
    chatListScreen.classList.add('is-inactive');
    chatScreen.classList.add('is-inactive');
    characterSelectionScreen.classList.remove('is-inactive');
    tutorialOnScreenChange('character-selection');
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
        stopParticles();
        if (window._musicFeatureReady) leaveChatMusic();
        if ('speechSynthesis' in window) speechSynthesis.cancel();
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
        tutorialOnScreenChange('character-selection');
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
    <img src="${escapeHtml(avatarSrc || '')}" alt="Avatar" class="${avatarSrc ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
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

  // Characters whose chats lose a participant are written back too, or the
  // cleanup would only last until the next reload.
  const changedOwners = [];
  for (const ownerId in characters) {
    const chats = characters[ownerId]?.chats || {};
    let changed = false;
    for (const chatId in chats) {
      const chat = chats[chatId];
      if (Array.isArray(chat?.participants)) {
        const kept = chat.participants.filter(pid => !toDelete.has(pid));
        if (kept.length !== chat.participants.length) {
          chat.participants = kept;
          changed = true;
        }
      }
    }
    if (changed) changedOwners.push(characters[ownerId]);
  }

  if (typeof currentCharacterId !== 'undefined' && toDelete.has(currentCharacterId)) {
    try { currentCharacterId = null; } catch (_) {}
    try { currentChatId = null; } catch (_) {}
  }

  try {
    await deleteMultipleCharactersFromDB(ids);
    for (const owner of changedOwners) await saveSingleCharacterToDB(owner);
    renderCharacterList();
  } catch (e) {
    showErrorAlert('Error while deleting: ' + (e?.message || e));
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



// Encodes a canvas as webp, falling back to jpeg where webp isn't available.
async function canvasToWebp(canvas, quality = 0.80) {
  let blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  );

  if (!blob) {
    blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion failed'))), 'image/jpeg', 0.80)
    );
  }

  const dataURL = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });

  return { blob, dataURL };
}

// `maxSide` caps the longest edge of the result, shrinking oversized pictures
// before they are encoded. 0 (the default) stores them at their own size.
async function imageFileToWebp(file, quality = 0.80, maxSide = 0) {
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

  const sourceW = source.width || source.naturalWidth;
  const sourceH = source.height || source.naturalHeight;
  const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(sourceW, sourceH)) : 1;
  const width = Math.max(1, Math.round(sourceW * scale));
  const height = Math.max(1, Math.round(sourceH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);

  const { blob, dataURL } = await canvasToWebp(canvas, quality);
  if (typeof source.close === 'function') source.close();
  return { blob, dataURL, originalDataURL };
}



    async function startChat(charId, chatId) {
    // Only clear the selected group-chat name tag when actually switching to a
    // different chat. Re-rendering the same chat (after editing/deleting a
    // message, switching a variant, etc.) must keep the current selection.
    if (charId !== currentCharacterId || chatId !== currentChatId) {
        clearActiveGroupParticipant();
        // Each chat keeps its own unsent message.
        loadChatDraft(charId, chatId);
    }
    cancelReplyOptions();
    starsContainer.classList.remove('visible');
    currentCharacterId = charId;
    currentChatId = chatId;
    localStorage.setItem('activeCharacterId', charId);
    localStorage.setItem('activeChatId', chatId);

    const character = characters[charId];
    const chat = character.chats[chatId];

    // Keep the chat list in sync so leaving this chat returns to its group.
    const chatGroupIdOnOpen = getChatGroupId(chat);
    openChatGroupId = getChatGroups(character)[chatGroupIdOnOpen] ? chatGroupIdOnOpen : null;

    // Opening a chat only needs a write when the migrations below actually
    // change something; the whole character (images and all) used to be
    // rewritten on every open, variant swap and edit.
    const chatShapeBefore = JSON.stringify([chat.participants, chat.activePersonaId, chat.mood, chat.memories, chat.storyLine, chat.plan]);
    if (!chat.participants) chat.participants = [charId];
    if (chat.activePersonaId === undefined) chat.activePersonaId = null;
    chat.mood = normalizeMood(chat.mood);
    // A Story Line - and before it a General Plot plus milestones - is memory
    // text now, so it is folded into this chat's memories instead of dropped.
    chat.memories = getChatMemories(chat);
    delete chat.storyLine;
    delete chat.plan;
    const chatNeedsSave = JSON.stringify([chat.participants, chat.activePersonaId, chat.mood, chat.memories, chat.storyLine, chat.plan]) !== chatShapeBefore;
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

    const isWorldChat = character.type === 'world';
    if (chatWorldBadge) chatWorldBadge.classList.toggle('hidden', !isWorldChat);
    const headerAvatarUrl = isWorldChat ? character.background : character.avatar;

chatAvatar.onerror = () => {
    chatAvatar.classList.add('hidden');
    chatAvatarPlaceholder.classList.remove('hidden');
    chatAvatarPlaceholder.textContent = isWorldChat ? '🌍' : '👤';
};

if (headerAvatarUrl) {
    chatAvatar.src = getImageUrl(headerAvatarUrl);
    smartObjectFit(chatAvatar);
    chatAvatar.classList.remove('hidden');
    chatAvatarPlaceholder.classList.add('hidden');
} else {
    chatAvatar.classList.add('hidden');
    chatAvatarPlaceholder.classList.remove('hidden');
    chatAvatarPlaceholder.textContent = isWorldChat ? '🌍' : '👤';
}

    const chatScreenDiv = document.getElementById('chat-screen');
    if (character.background) {
    chatScreenDiv.style.backgroundImage = cssUrl(getImageUrl(character.background));
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
    updateChatReplyControls();
    updateChatMemoriesButtonState();
    updateTokenCount();
    updateMoodButton();
    updateParticleButton();
    startParticles(getEffectiveParticleEffect(character, chat), fxSavedLevels(character));
    refreshChatSearchAfterRender();
    if (window._musicFeatureReady) loadChatMusic(charId, chatId);
    if (chatNeedsSave) await saveSingleCharacterToDB(character);
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



async function createNewChat(initialMessage = null, scenarioName = null, initialMood = null, scenarioSource = null) {
    if (!currentCharacterId) return;
    const character = characters[currentCharacterId];
    if (!character.chats) {
        character.chats = {};
    }
    const isWorldCard = character.type === 'world';
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
        // A scenario greeting may be written with {{char}} so one text can serve
        // several characters. The opening message is read and edited as it stands,
        // so the name is baked in here rather than left to the prompt builder.
        const charNameForGreeting = character.chatName || character.name;
        const openingText = charNameForGreeting
            ? applyCharPlaceholder(initialMessage, charNameForGreeting)
            : initialMessage;
        const messageObject = {
            id: 'msg-' + Date.now(),
            sender: 'ai',
            type: isWorldCard ? 'story' : 'dialog',
            variations: [{ main: openingText, think: null }],
            activeVariant: 0
        };
        history.push(messageObject);
    }
    const worldParticipants = isWorldCard
        ? [currentCharacterId, ...(character.characterIds || []).filter(id => characters[id])]
        : [currentCharacterId];
    // New chats land in the group that is currently open, but never in a group
    // left over from another character (e.g. after the random-chat button).
    const targetGroupId = (openChatGroupId && getChatGroups(character)[openChatGroupId])
        ? openChatGroupId
        : null;
    character.chats[newChatId] = {
        id: newChatId,
        name: newName,
        history: history,
        // The scenario's memories are the template; the chat gets its own copy,
        // so rewriting one chat's leaves the scenario and the other chats alone.
        memories: (scenarioSource && normalizeScenario(scenarioSource)?.memories) || '',
        participants: worldParticipants,
        activePersonaId: null,
        mood: normalizeMood(initialMood),
        groupId: targetGroupId
    };
    await saveSingleCharacterToDB(character);
    window.__scrollToBottomNextStartChat = true;
await startChat(currentCharacterId, newChatId);
}



// Escapes only the structural characters, leaving quotes as literal characters
// so formatSubString can still find quoted speech and style it. Safe for text
// between tags; NEVER use it for an attribute value - use escapeHtml there.
function escapeHtmlKeepingQuotes(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// For text that has already had & < > escaped and only needs to be made safe
// for an attribute value.
function escapeQuotes(s) {
  return String(s)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function extractReasoningDelta(delta) {
    if (!delta || typeof delta !== 'object') return '';
    if (typeof delta.reasoning === 'string' && delta.reasoning) return delta.reasoning;
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) return delta.reasoning_content;
    if (!Array.isArray(delta.reasoning_details)) return '';

    return delta.reasoning_details.map(detail => {
        if (!detail || typeof detail !== 'object') return '';
        if (detail.type === 'reasoning.text' && typeof detail.text === 'string') {
            return detail.text;
        }
        if (detail.type === 'reasoning.summary') {
            if (typeof detail.summary === 'string') return detail.summary;
            if (Array.isArray(detail.summary)) {
                return detail.summary.map(item => (
                    typeof item === 'string'
                        ? item
                        : (item && typeof item.text === 'string' ? item.text : '')
                )).join('');
            }
        }
        return '';
    }).join('');
}

function formatSubString(text) {
    if (!text) return '';

    const markdownImageRegex = /!\[.*?\]\((https?:\/\/[^\s<>]+\.(?:jpg|jpeg|png|gif|webp|avif)[^\s<>]*)\)/gi;
    const bareImageUrlRegex = /(https?:\/\/[^\s<>]+\.(?:jpg|jpeg|png|gif|webp|avif)[^\s<>]*)/gi;

    let imagesHtml = '';
    let processedText = text;

        // These two run against raw text, so the captured URL still needs full
    // escaping before it can be placed inside a src attribute. The regexes
    // exclude whitespace and angle brackets but not quotes, so without this a
    // URL like https://x/a".onerror="..".png would break out of the attribute.
    processedText = processedText.replace(markdownImageRegex, (match, url) => {
        imagesHtml += `<div class="message-image-container"><img src="${escapeHtml(url)}" alt="Image from chat" loading="lazy"></div>`;
        return '';
    });

    processedText = processedText.replace(bareImageUrlRegex, (url) => {
        imagesHtml += `<div class="message-image-container"><img src="${escapeHtml(url)}" alt="Image from chat" loading="lazy"></div>`;
        return '';
    });

    const safeRemainingText = escapeHtmlKeepingQuotes(processedText.trim())
        .replace(/"(.*?)"/g, '<span class="dialogue">"$1"</span>')
        .replace(/“(.*?)”/g, '<span class="dialogue">“$1”</span>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/((?:https?:\/\/|www\.)[^\s<>()]+)/gi, (url) => {
            let href = url;
            if (href.toLowerCase().startsWith('www.')) {
                href = 'http://' + href;
            }
            // & < > are already escaped by this point, so escaping them again
            // would double-encode; only the quotes still have to be handled.
            return `<a href="${escapeQuotes(href)}" target="_blank" style="text-decoration: underline; color: inherit;">${url}</a>`;
        });

    return imagesHtml + safeRemainingText;
}

// Generated pictures hang off the variation they illustrate, so switching
// variants swaps the images along with the text. Nodes are built with the DOM
// API and `src` is assigned as a property, never interpolated into markup.
// Creates the container that holds generated pictures, placing it directly
// after the message text. Shared by the renderer and the pending placeholder.
function ensureImagesHolder(messageElement) {
    let holder = messageElement.querySelector('.generated-images');
    if (holder) return holder;
    holder = document.createElement('div');
    holder.className = 'generated-images';
    const mainContent = messageElement.querySelector('.main-content');
    if (mainContent && mainContent.parentNode === messageElement) {
        mainContent.insertAdjacentElement('afterend', holder);
    } else {
        messageElement.appendChild(holder);
    }
    return holder;
}

function renderVariationImages(messageElement, variation, message) {
    if (!messageElement) return;

    let holder = messageElement.querySelector('.generated-images');
    const images = Array.isArray(variation?.images) ? variation.images : [];
    // A generation in progress lives in this holder too and must outlive a
    // re-render, so it is detached first and put back afterwards.
    const pending = holder?.querySelector('.generated-image-pending') || null;

    if (!images.length) {
        if (holder && !pending) holder.remove();
        else if (holder) holder.dataset.renderedIds = '';
        return;
    }

    if (!holder) holder = ensureImagesHolder(messageElement);

    const ids = images.map(i => i.id).join(',');
    if (holder.dataset.renderedIds === ids && !pending) return;
    holder.dataset.renderedIds = ids;
    if (pending) pending.remove();
    holder.innerHTML = '';

    images.forEach(image => {
        const container = document.createElement('div');
        container.className = 'message-image-container generated-image';

        const img = document.createElement('img');
        img.src = image.dataUrl || image.url || '';
        img.alt = image.prompt ? `Generated image: ${image.prompt}` : 'Generated image';
        img.loading = 'lazy';
        img.title = image.prompt || '';
        img.addEventListener('error', () => {
            container.classList.add('image-failed');
            if (!container.querySelector('.generated-image-error')) {
                const note = document.createElement('div');
                note.className = 'generated-image-error';
                note.textContent = 'Image could not be loaded.';
                container.appendChild(note);
            }
        });
        container.appendChild(img);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-generated-image-btn';
        removeBtn.title = 'Remove this image';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleRemoveGeneratedImage(message?.id, image.id);
        });
        container.appendChild(removeBtn);

        holder.appendChild(container);
    });

    if (pending) holder.appendChild(pending);
}

// A placeholder in the bubble, where the picture will land. The free tier can
// queue for the better part of a minute, so it reports elapsed time and offers
// a way out rather than leaving the user guessing.
function showImagePendingBlock(messageElement, { providerLabel, onCancel }) {
    const holder = ensureImagesHolder(messageElement);
    holder.querySelector('.generated-image-pending')?.remove();

    const box = document.createElement('div');
    box.className = 'generated-image-pending';

    const row = document.createElement('div');
    row.className = 'generated-image-pending-row';

    const spinner = document.createElement('span');
    spinner.className = 'btn-spinner';
    row.appendChild(spinner);

    const label = document.createElement('span');
    label.className = 'generated-image-pending-label';
    // The provider is named so it is obvious whether this one costs money.
    label.textContent = `Generating image (${providerLabel})…`;
    row.appendChild(label);

    const timer = document.createElement('span');
    timer.className = 'generated-image-pending-timer';
    timer.textContent = '0s';
    row.appendChild(timer);

    box.appendChild(row);

    const hint = document.createElement('div');
    hint.className = 'generated-image-pending-hint';
    box.appendChild(hint);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'generated-image-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling…';
        onCancel?.();
    });
    box.appendChild(cancelBtn);

    holder.appendChild(box);

    const started = Date.now();
    const ticker = setInterval(() => {
        const seconds = Math.round((Date.now() - started) / 1000);
        timer.textContent = `${seconds}s`;
        if (seconds === 15) {
            hint.textContent = 'The free service queues busy requests — this can take up to a minute.';
        }
    }, 1000);

    return {
        remove() {
            clearInterval(ticker);
            box.remove();
            if (holder.isConnected && !holder.children.length) holder.remove();
        }
    };
}

// Text is revealed at the rate it is arriving, not at a fixed number of characters per
// frame. Models deliver a token at a time in an uneven rhythm, and a fixed rate empties
// the buffer between tokens, so the reply appeared in bursts with dead stops in between -
// and could never keep up with a fast model, which left a large jump at the end instead.
// Spending a constant window on whatever text is waiting settles the reveal at the speed
// the model is actually producing: the bubble keeps a little text in hand and keeps moving.
function createTypewriter() {
    const CATCH_UP_WINDOW = 0.25;      // seconds to spend on the text currently waiting
    const MIN_CHARS_PER_SECOND = 14;   // so the last characters cannot crawl to a halt
    const MAX_CHARS_PER_SECOND = 1600; // an upper bound for the very fastest models
    const MAX_FRAME_SECONDS = 0.25;    // a long frame must not release a burst at once

    let target = '';
    let shown = 0;        // fractional, so the pace does not depend on the frame rate
    let rafId = null;
    let lastFrameAt = 0;
    let onRender = null;

    function tick(now) {
        const dt = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
        lastFrameAt = now;

        const waiting = target.length - shown;
        if (waiting > 0) {
            const speed = Math.min(Math.max(waiting / CATCH_UP_WINDOW, MIN_CHARS_PER_SECOND), MAX_CHARS_PER_SECOND);
            const before = Math.floor(shown);
            shown = Math.min(shown + speed * dt, target.length);
            if (onRender && Math.floor(shown) > before) onRender(target.slice(0, Math.floor(shown)));
        }

        if (shown < target.length) {
            rafId = requestAnimationFrame(tick);
        } else {
            rafId = null;
            lastFrameAt = 0;
        }
    }

    return {
        init(text) { target = text; shown = text.length; },
        update(text, renderer) {
            onRender = renderer;
            if (text.length > target.length) {
                target = text;
                // A tab in the background is served no animation frames at all, so the reveal
                // froze mid-reply and then replayed the whole backlog in one burst when the tab
                // was looked at again. Nobody is watching a hidden tab, so there is nothing to
                // animate: show the text in full as it arrives and let the animation pick up
                // again on return. Chunks keep arriving while hidden, so this keeps the bubble
                // current until the stream ends.
                if (document.hidden) {
                    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                    lastFrameAt = 0;
                    shown = target.length;
                    onRender(target);
                    return;
                }
                // A fresh timestamp, or the gap since the last run would count as elapsed time.
                if (!rafId) { lastFrameAt = 0; rafId = requestAnimationFrame(tick); }
            }
        },
        flush(text, renderer) {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            lastFrameAt = 0;
            target = text;
            shown = text.length;
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



// Message elements are updated in place (streaming, variant swipes, edits), so the
// read-aloud button must pull the text from the live history entry when it is clicked
// instead of the snapshot that existed when the element was built. Otherwise a freshly
// streamed reply is still read as the '...' placeholder it started out as.
function getMessageSpeechText(message) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    const liveMessage = chat?.history?.find(m => m.id === message.id) || message;
    if (liveMessage.sender === 'user') return liveMessage.main || '';
    return liveMessage.variations?.[liveMessage.activeVariant]?.main || '';
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
avatarContainer.style.backgroundImage = cssUrl(getImageUrl(personaAvatarUrl));

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

            if (speakerCharacter && speakerCharacter.type !== 'world') {
                const avatarUrl = speakerCharacter.avatar;
                const avatarContainer = document.createElement('div');
avatarContainer.className = 'message-avatar';

const placeholderDiv = document.createElement('div');
placeholderDiv.className = 'message-avatar placeholder-icon';
placeholderDiv.innerHTML = '👤';
placeholderDiv.title = speakerCharacter.name || 'Unknown';

if (avatarUrl) {
    avatarContainer.classList.add('effect-container');
    avatarContainer.style.backgroundImage = cssUrl(getImageUrl(avatarUrl));

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

    if (message.sender === 'ai') {
        const activeVariantForImages = message.variations?.[message.activeVariant];
        if (activeVariantForImages?.images?.length) {
            renderVariationImages(messageElement, activeVariantForImages, message);
        }
    }

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
    if (message.sender === 'ai' && 'speechSynthesis' in window) {
        const ttsBtn = document.createElement('button');
        ttsBtn.className = 'tts-btn message-action-btn';
        ttsBtn.title = 'Read aloud';
        ttsBtn.textContent = '🔊';
        ttsBtn.addEventListener('click', () => {
            if (speechSynthesis.speaking) {
                speechSynthesis.cancel();
                ttsBtn.textContent = '🔊';
            } else {
                speakText(getMessageSpeechText(message), message.id);
            }
        });
        actionGroup.appendChild(ttsBtn);
    }
    if (message.sender === 'ai' && isImageGenUnlocked()) {
        const imageBtn = document.createElement('button');
        imageBtn.className = 'generate-image-btn message-action-btn';
        imageBtn.title = 'Illustrate this scene';
        imageBtn.textContent = '🎨';
        imageBtn.addEventListener('click', () => handleGenerateImage(message.id, imageBtn));
        actionGroup.appendChild(imageBtn);
    }
    // Copy, bookmark, hide and branch live behind one button, so the row of
    // actions on every message does not grow.
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'message-more-btn message-action-btn';
    moreBtn.title = 'More';
    moreBtn.setAttribute('aria-label', 'More message actions');
    moreBtn.setAttribute('aria-haspopup', 'true');
    moreBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/><circle cx="13" cy="8" r="1.6"/></svg>`;
    actionGroup.appendChild(moreBtn);
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

    if (message.dice) messageElement.classList.add('dice-message');
    applyMessageFlags(messageElement, message);

    chatWindow.appendChild(messageWrapper);
    return messageWrapper;
}

// The small marks a message carries for the user: a star when bookmarked, and
// a faded bubble with a note when it is hidden from the AI.
function applyMessageFlags(messageElement, message) {
    if (!messageElement || !message) return;
    const bookmarked = message.bookmarked === true;
    const hidden = isHiddenFromAI(message);
    messageElement.classList.toggle('is-bookmarked', bookmarked);
    messageElement.classList.toggle('is-hidden-from-ai', hidden);

    let star = messageElement.querySelector(':scope > .message-bookmark-flag');
    if (bookmarked && !star) {
        star = document.createElement('span');
        star.className = 'message-bookmark-flag';
        star.title = 'Bookmarked';
        star.textContent = '★';
        messageElement.appendChild(star);
    } else if (!bookmarked && star) {
        star.remove();
    }

    let note = messageElement.querySelector(':scope > .message-hidden-note');
    if (hidden && !note) {
        note = document.createElement('div');
        note.className = 'message-hidden-note';
        note.textContent = 'Hidden from the AI';
        const anchor = messageElement.querySelector(':scope > .message-action-group');
        messageElement.insertBefore(note, anchor);
    } else if (!hidden && note) {
        note.remove();
    }
}



async function addNewMessage(rawMessage, sender, type = 'dialog', forceScroll = false, extra = null) {
    const messageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const ownerCharacter = characters[currentCharacterId];
    const chat = ownerCharacter?.chats?.[currentChatId];
    if (!chat) return;

    let messageObject;

    if (sender === 'user') {
        messageObject = { id: messageId, sender: 'user', main: rawMessage, ...(extra || {}) };
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
    // Only the character that owns this chat changed. Rewriting the whole
    // collection here cost a full clear and re-put of every card (the starter
    // pack alone is ~18 MB) on each message sent.
    await saveSingleCharacterToDB(ownerCharacter);
    displayMessage(messageObject);
    if (forceScroll) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
}



// `autoTurn` is one turn of "Let Them Talk": no user message, the box and
// whatever is typed in it are left alone, and the tagged character answers the
// last reply.
/* ===========================================================================
 * DICE ROLL ANIMATION
 * ===========================================================================
 * A short scene in front of the chat: the screen dims, the dice tumble in and
 * land on the result, then it all fades away. The promise resolves as the dice
 * land, so the roll is posted at that moment. A click or Escape skips ahead.
 * ======================================================================== */

// Matches the dice-tumble animation in style.css.
const DICE_LAND_MS = 760;
const DICE_STAGGER_MS = 70;
const DICE_HOLD_MS = 1000;
// The Natural 20 sound's rising notes begin 0.34 s in. Started this much
// before the landing, they ring out just as the die comes to rest.
const DICE_NAT20_SOUND_LEAD_MS = 340;
let diceRollShowing = false;

function diceFaceSvg(sides) {
    if (sides === 6) {
        return `<svg viewBox="0 0 100 100" aria-hidden="true">
            <rect class="dice-face-darker" x="14" y="14" width="78" height="78" rx="16"/>
            <rect class="dice-face-front" x="6" y="6" width="78" height="78" rx="16"/>
        </svg>`;
    }
    // A d20 seen face-on: the front triangle and the nine faces around it.
    const faces = [
        ['front', '50,21 79,69 21,69'],
        ['light', '50,3 9,26.5 50,21'],
        ['light', '50,3 50,21 91,26.5'],
        ['mid', '9,26.5 21,69 50,21'],
        ['mid', '91,26.5 50,21 79,69'],
        ['dark', '9,26.5 9,73.5 21,69'],
        ['dark', '91,26.5 79,69 91,73.5'],
        ['darker', '9,73.5 50,97 21,69'],
        ['darker', '91,73.5 79,69 50,97'],
        ['dark', '21,69 79,69 50,97'],
    ];
    return `<svg viewBox="0 0 100 100" aria-hidden="true">${faces
        .map(([shade, points]) => `<polygon class="dice-face-${shade}" points="${points}"/>`).join('')}</svg>`;
}

function showDiceRoll(spec, result) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Up to four dice each show their own roll; more than that, one die shows the total.
    const showEach = spec.count <= 4;
    const values = showEach ? result.rolls : [result.total];
    const isD20 = spec.count === 1 && spec.sides === 20;
    const nat20 = isD20 && result.rolls[0] === 20;
    const nat1 = isD20 && result.rolls[0] === 1;
    const sign = spec.modifier > 0 ? '+' : '-';
    const notation = `${spec.count}d${spec.sides}${spec.modifier ? `${sign}${Math.abs(spec.modifier)}` : ''}`;
    const totalLine = nat20 ? 'Natural 20!'
        : nat1 ? 'Natural 1'
        : showEach && (spec.count > 1 || spec.modifier) ? `Total ${result.total}` : '';
    const landAt = reduced ? 0 : DICE_LAND_MS + (values.length - 1) * DICE_STAGGER_MS;
    // Stand-in numbers while the dice tumble, from the range they can show.
    const low = showEach ? 1 : spec.count + spec.modifier;
    const high = showEach ? spec.sides : spec.count * spec.sides + spec.modifier;
    const randomFace = () => low + Math.floor(Math.random() * (high - low + 1));
    const between = (a, b) => Math.round(a + Math.random() * (b - a));

    const overlay = document.createElement('div');
    overlay.className = 'dice-roll-overlay';
    // The roll itself is posted to the chat; this is only the show.
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <div class="dice-roll-stage" style="--dice-count:${values.length}">
            ${values.map((_, i) => `
            <div class="dice-roll-die${showEach && spec.sides === 6 ? ' is-d6' : ''}" style="--delay:${i * DICE_STAGGER_MS}ms; --from-x:${between(60, 170) * (Math.random() < 0.5 ? -1 : 1)}px; --from-y:${between(-150, -70)}px; --spin:${between(360, 720) * (Math.random() < 0.5 ? -1 : 1)}deg">
                ${diceFaceSvg(showEach ? spec.sides : 20)}
                <span class="dice-roll-value"></span>
            </div>`).join('')}
            ${nat20 ? `<div class="dice-roll-burst">${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg"></i>`).join('')}</div>` : ''}
        </div>
        <div class="dice-roll-caption">
            <span class="dice-roll-notation">${notation}</span>
            ${totalLine ? `<span class="dice-roll-total">${totalLine}</span>` : ''}
        </div>`;

    const dieEls = [...overlay.querySelectorAll('.dice-roll-die')];
    const landed = values.map(() => false);
    const setValue = (i, value) => {
        const el = dieEls[i].querySelector('.dice-roll-value');
        el.textContent = value;
        el.dataset.digits = String(value).length;
    };
    values.forEach((value, i) => setValue(i, reduced ? value : randomFace()));
    document.body.appendChild(overlay);
    diceRollShowing = true;
    if (nat20) playSound('dice-nat20', { delayMs: Math.max(0, landAt - DICE_NAT20_SOUND_LEAD_MS) });

    let resolveLanded;
    const landedPromise = new Promise(resolve => { resolveLanded = resolve; });
    const timers = [];
    const cycle = reduced ? null : setInterval(() => {
        landed.forEach((done, i) => { if (!done) setValue(i, randomFace()); });
    }, 60);
    const landDie = i => {
        landed[i] = true;
        setValue(i, values[i]);
        dieEls[i].classList.add('landed');
    };
    const reveal = () => {
        if (overlay.classList.contains('revealed')) return;
        clearInterval(cycle);
        landed.forEach((done, i) => { if (!done) landDie(i); });
        overlay.classList.add('revealed');
        if (nat20) overlay.classList.add('is-crit');
        if (nat1) overlay.classList.add('is-fumble');
        diceRollShowing = false;
        resolveLanded();
    };
    let finished = false;
    const onKey = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish();
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        reveal();
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.add('leaving');
        setTimeout(() => overlay.remove(), 280);
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', finish);
    if (!reduced) values.forEach((_, i) => timers.push(setTimeout(() => landDie(i), DICE_LAND_MS + i * DICE_STAGGER_MS)));
    timers.push(setTimeout(reveal, landAt));
    timers.push(setTimeout(finish, landAt + DICE_HOLD_MS));
    return landedPromise;
}

async function handleChatSubmit(type, { autoTurn = false } = {}) {
    let rolledDice = false;
    if (!autoTurn) {
        const dice = parseDiceCommand(messageInput.value);
        if (dice) {
            if (dice.error) { showErrorAlert(dice.error); return; }
            // The box still holds the command while the dice tumble, and a
            // second Enter must not roll again.
            if (diceRollShowing) return;
            const result = rollDice(dice);
            const rollLine = formatDiceResult(dice, result);
            await showDiceRoll(dice, result);
            rolledDice = true;
            if (!dice.text) {
                // A bare roll is only posted. The user decides what to do
                // with it, or sends an empty message to let the AI react.
                messageInput.value = '';
                clearChatDraft();
                autoResizeTextarea({ target: messageInput });
                hideUndoDeleteFab();
                cancelReplyOptions();
                await addNewMessage(rollLine, 'user', 'dialog', true, { dice: true });
                updateTokenCount();
                checkChatMilestones(characters[currentCharacterId], characters[currentCharacterId]?.chats?.[currentChatId]);
                return;
            }
            messageInput.value = `${rollLine}\n${dice.text}`;
        }
    }
    // Set before the message box is focused below, since that focus fires the
    // handler that requests reply suggestions.
    chatTurnInProgress = true;
    hideUndoDeleteFab();
    // Suggestions for the reply being answered are now stale. Dropping the
    // round in flight matters as much as hiding the bar: its answer used to
    // arrive mid-stream and reopen the bar over the reply being written.
    cancelReplyOptions();
    const userMessageRaw = autoTurn ? '' : messageInput.value.trim();
    if (!autoTurn) {
        messageInput.value = '';
        clearChatDraft();
        stopVoiceInput({ discard: true });
        autoResizeTextarea({ target: messageInput });
        messageInput.focus();
    }
    let mainCharacter = characters[currentCharacterId];
    let chat = mainCharacter.chats[currentChatId];
    const selectedTargetCharId = getValidActiveGroupParticipantId(chat);
    const isWorldChat = mainCharacter?.type === 'world';
    const isNarratorRequest = type === 'story' || (isWorldChat && !selectedTargetCharId);
    let targetCharId = isNarratorRequest ? currentCharacterId : (selectedTargetCharId || currentCharacterId);
    let finalUserMessage = userMessageRaw;

    hideGroupCharDropdown();

    // In World chats, the "Character" button only replies as a specific character when one is
    // tagged via the participant selector. With no character tagged, the reply target is the
    // World itself — asking it to reply "as a character" makes the AI invent and name one
    // (often "Narrator"). So treat an untagged Character reply as narration, i.e. the Character
    // button behaves exactly like the Narrator button.
    if (isNarratorRequest) {
        type = 'story';
    }

    let messageForAPI;
    let historyForAPI;
    let lastMessageInChat = chat.history && chat.history.length > 0 ? chat.history[chat.history.length - 1] : null;

    if (finalUserMessage) {
        if (!rolledDice) playSound('send');
        await addNewMessage(finalUserMessage, 'user', type, true);
        messageForAPI = finalUserMessage;
        const isMultiChar = chat.participants && chat.participants.length > 1;
        historyForAPI = historyForPrompt(chat.history.slice(0, -1)).map(msg => {
    const activePersona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
    if (msg.sender === 'ai') {
        const speaker = characters[msg.speakerId || currentCharacterId];
        const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
        let processedText = applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName);
        processedText = applyUserPlaceholder(processedText, activePersona);
        return { sender: 'ai', main: msg.type === 'story' ? `[Narration] ${processedText}` : (isMultiChar && speaker?.type !== 'world') ? `${speakerName}: ${processedText}` : processedText };
    } else {
        const userName = activePersona?.chatName || activePersona?.name || 'User';
        let processedText = applyUserPlaceholder(msg.main, activePersona);
        return { sender: 'user', main: isMultiChar ? `${userName}: ${processedText}` : processedText };
    }
});
    } else {
    const promptHistory = historyForPrompt(chat.history);
    if (promptHistory.length === 0) {
        messageForAPI = "Start the roleplay with a creative, exciting scenario, and introduce the central character in typical manner.";
        historyForAPI = [];
    } else {
        const historyCopy = [...promptHistory];
        const lastMessage = historyCopy.pop();
        const lastVariant = lastMessage.variations ? lastMessage.variations[lastMessage.activeVariant] : null;
        const lastMainText = lastMessage.main || (lastVariant ? lastVariant.main : '');
        const trimmedLastMain = (lastMainText || '').trim();
        messageForAPI = trimmedLastMain || "Continue the scene plausibly based on the latest turn.";
        if (autoTurn && lastMessage.sender === 'ai') {
            // Someone else usually spoke last, so the line is handed over with
            // its speaker's name and the turn is passed on explicitly.
            const lastSpeakerId = lastMessage.speakerId || currentCharacterId;
            const lastSpeaker = lastMessage.type === 'story' ? null : characters[lastSpeakerId];
            const spokenBy = lastSpeaker && lastSpeaker.type !== 'world' && lastSpeakerId !== targetCharId
                ? `${lastSpeaker.chatName || lastSpeaker.name}: `
                : '';
            const turnTaker = characters[targetCharId];
            const turnTakerName = turnTaker?.chatName || turnTaker?.name || 'the character';
            messageForAPI = `${spokenBy}${messageForAPI}\n\n(It is now ${turnTakerName}'s turn. React in character to what just happened and move the conversation forward with something new. Do not repeat earlier lines.)`;
        } else if (lastMessage.sender === 'ai') {
            messageForAPI += "\n\n(Continue the scene from your previous reply with new content. Do not repeat earlier sentences and drive the scene actively forward.)";
        }
        const isMultiChar = chat.participants && chat.participants.length > 1;
        const historyPersona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
        historyForAPI = historyCopy.map(msg => {
            if (msg.sender === 'ai') {
                const speaker = characters[msg.speakerId || currentCharacterId];
                const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
                const text = fillPromptPlaceholders(msg.variations[msg.activeVariant].main, speakerName, historyPersona);
                return { sender: 'ai', main: msg.type === 'story' ? `[Narration] ${text}` : (isMultiChar && speaker?.type !== 'world') ? `${speakerName}: ${text}` : text };
            }
            const userName = historyPersona?.chatName || historyPersona?.name || 'User';
            const text = applyUserPlaceholder(msg.main, historyPersona);
            return { sender: 'user', main: isMultiChar ? `${userName}: ${text}` : text };
        });
    }
}

    const targetCharacter = characters[targetCharId];
    const charNameForAI = targetCharacter.chatName || targetCharacter.name;
    const activePersonaId = chat.activePersonaId;
    const persona = activePersonaId ? personas[activePersonaId] : null;

    // Text scanned for keyword-triggered lore entries: the last few turns plus the current message.
    const loreScanText = [
        ...((historyForAPI || []).slice(-6).map(h => h.main || '')),
        messageForAPI || ''
    ].join('\n');

    const currentModelId = modelSelect.value || defaultSettings.model;
    const modelSettings = appSettings.availableModels.find(m => m.id === currentModelId);

    loadingIndicator.classList.remove('hidden');
    dialogBtn.disabled = true;
    storyBtn.disabled = true;
    stopStreamBtn.classList.remove('hidden');
    const MAX_RETRIES = 90;
    const streamController = new AbortController();
    const streamSignal = streamController.signal;
    currentStreamController = streamController;
    let fullReply = '';
    let reasoningBuf = '';
    let streamAbortedByUser = false;
    let emptyReplies = 0;
    let networkFailures = 0;
    let rateLimitRetries = 0;
    let bubbleStatus = null;
    let keptPartialReply = false;
    const newMessageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    let isFirstChunk = true;
    const aiMessageObject = {
        id: newMessageId,
        sender: 'ai',
        type: type,
        variations: [{ main: '...', think: null }],
        activeVariant: 0,
        isStreaming: true,
        streamingVariant: 0
    };
    if (type === 'dialog') aiMessageObject.speakerId = targetCharId;
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
    if (aiMessageObject.variations[0].main === '...') {
        bubbleStatus = "Connecting to AI Model - Please wait or regenerate the message.";
        showBubbleStatus(newMessageId, bubbleStatus);
    }
}, 20000);
const serverHungTimer = setTimeout(() => {
    if (aiMessageObject.variations[0].main === '...' && bubbleStatus && bubbleStatus.includes("Connecting to AI Model")) {
        bubbleStatus = "The AI provider may be experiencing issues - Please wait a moment or try again later.";
        showBubbleStatus(newMessageId, bubbleStatus);
    }
}, 70000);

const clearStreamTimers = () => {
    clearTimeout(coldStartTimer);
    clearTimeout(serverHungTimer);
};

const startTime = Date.now();
    chatWindow.scrollTop = chatWindow.scrollHeight;
    chatWindow._autoScroll = true;

    let fullSystemPrompt = '';
    if (modelSettings && modelSettings.instructions && modelSettings.instructions.trim() !== '') {
        fullSystemPrompt += `--- GLOBAL AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(modelSettings.instructions.trim(), charNameForAI), persona)}\n\n`;
    }
    if (persona) {
        fullSystemPrompt += `--- EXACT USER PERSONA ---\nName: ${persona.chatName || persona.name}\nDescription: ${applyUserPlaceholder(applyCharPlaceholder(persona.description, charNameForAI), persona)}\n---\n\n`;
    }
    const worldChar = isWorldChat ? characters[currentCharacterId] : null;

    if (isWorldChat) {
        const worldName = worldChar.name || 'This World';
        if (worldChar.description) fullSystemPrompt += `--- WORLD CONTEXT ---\nWorld: ${worldName}\n${fillPromptPlaceholders(worldChar.description.trim(), charNameForAI, persona)}\n\n`;
        const worldLoreText = getLoreText(worldChar, loreScanText);
        if (worldLoreText) fullSystemPrompt += `--- WORLD LORE & HISTORY ---\n${fillPromptPlaceholders(worldLoreText, charNameForAI, persona)}\n\n`;
        if (worldChar.reminder) fullSystemPrompt += `--- WORLD RULES (CRITICAL — THESE RULES MAY NEVER BE BROKEN UNDER ANY CIRCUMSTANCES) ---\n${fillPromptPlaceholders(worldChar.reminder.trim(), charNameForAI, persona)}\n\n`;
        if (targetCharId === currentCharacterId || type === 'story') {
            fullSystemPrompt += getNarratorMetaInstruction();
            const worldChars = chat.participants.filter(pid => pid !== currentCharacterId);
            if (worldChars.length > 0) {
                fullSystemPrompt += `--- CHARACTERS IN THIS WORLD ---\n`;
                worldChars.forEach(pid => {
                    const pChar = characters[pid];
                    if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
                });
                fullSystemPrompt += `\n`;
            }
        } else {
            if (targetCharacter.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(targetCharacter.instructions, charNameForAI), persona).trim()}\n\n`;
            if (targetCharacter.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${fillPromptPlaceholders(targetCharacter.description.trim(), charNameForAI, persona)}\n\n`;
            const charLoreText = getLoreText(targetCharacter, loreScanText);
            if (charLoreText) fullSystemPrompt += `--- CHARACTER LORE ---\n${fillPromptPlaceholders(charLoreText, charNameForAI, persona)}\n\n`;
        }
    } else if (type === 'story') {
        fullSystemPrompt += getNarratorMetaInstruction();
        fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
        chat.participants.forEach(pid => {
            const pChar = characters[pid];
            if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
        });
        const mainCharacterForLore = characters[currentCharacterId];
        const mainLoreText = getLoreText(mainCharacterForLore, loreScanText);
        if (mainLoreText) {
            fullSystemPrompt += `\n--- LORE / BACKGROUND KNOWLEDGE ---\n${fillPromptPlaceholders(mainLoreText, charNameForAI, persona)}\n\n`;
        }
    } else {
        if (chat.participants && chat.participants.length > 1) {
            fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
            chat.participants.forEach(pid => {
                const pChar = characters[pid];
                if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
            });
            fullSystemPrompt += `\n`;
        }
        if (targetCharacter.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(targetCharacter.instructions, charNameForAI), persona).trim()}\n\n`;
        if (targetCharacter.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${fillPromptPlaceholders(targetCharacter.description.trim(), charNameForAI, persona)}\n\n`;
        const targetLoreText = getLoreText(targetCharacter, loreScanText);
        if (targetLoreText) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${fillPromptPlaceholders(targetLoreText, charNameForAI, persona)}\n\n`;
    }
    fullSystemPrompt += getMoodSystemContext({
        mood: chat.mood,
        characterName: charNameForAI,
        isNarration: isWorldChat || type === 'story'
    });
    const chatMemoriesText = getChatMemories(chat);
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${fillPromptPlaceholders(chatMemoriesText, charNameForAI, persona)}\n\n`;
    }
    fullSystemPrompt += getReplyLengthInstruction(replyLength);
    const isMultiSpeakerScene = !!(chat.participants && chat.participants.length > 1);
    const needsSpeakerExclusivity = type === 'dialog' && isMultiSpeakerScene;
    if (needsSpeakerExclusivity) {
        fullSystemPrompt += getSpeakerExclusivityInstruction(charNameForAI, getOtherSpeakerNames(chat, targetCharId));
    }
    const finalMessageForAPI = messageForAPI;
    const globalDialogReminder = applyUserPlaceholder(applyCharPlaceholder((modelSettings && modelSettings.reminder) ? modelSettings.reminder.trim() : '', charNameForAI), persona);
    const globalNarratorReminder = applyUserPlaceholder(applyCharPlaceholder((modelSettings && modelSettings.narratorReminder) ? modelSettings.narratorReminder.trim() : '', charNameForAI), persona);
    const characterDialogReminder = applyUserPlaceholder((targetCharacter.reminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
    const characterNarratorReminder = applyUserPlaceholder((targetCharacter.narratorReminder || ''), persona).replace(/{{char}}/g, charNameForAI).trim();
    const combinedDialogReminder = [globalDialogReminder, characterDialogReminder].filter(Boolean).join('\n');
    const combinedNarratorReminder = [globalNarratorReminder, characterNarratorReminder].filter(Boolean).join('\n');
    const characterForAPI = { ...targetCharacter, description: fullSystemPrompt };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (streamSignal.aborted) { streamAbortedByUser = true; break; }
        try {
            console.log(`Send request (Attempt ${attempt}/${MAX_RETRIES})...`);
            const currentTemperature = temperatureSlider.value;
            const currentModel = modelSelect.value;
            const lastMessageInHistory = chat.history[chat.history.length - 1];

const apiKeyToSend = (modelSettings && modelSettings.apiKey) || appSettings.apiKey;
const targetApiUrlToSend = (modelSettings && modelSettings.targetApiUrl) || DEFAULT_API_URL;
const isLocal = targetApiUrlToSend && (
    targetApiUrlToSend.includes('localhost') ||
    targetApiUrlToSend.includes('127.0.0.1') ||
    targetApiUrlToSend.includes('::1') ||
    /^https?:\/\/192\.168\./.test(targetApiUrlToSend) ||
    /^https?:\/\/10\./.test(targetApiUrlToSend) ||
    /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./.test(targetApiUrlToSend)
);

const reminderContent = [
    type === 'dialog' ? combinedDialogReminder : combinedNarratorReminder,
    needsSpeakerExclusivity ? getSpeakerExclusivityReminderLine(charNameForAI) : ''
].filter(Boolean).join('\n');
const lastUserContent = reminderContent
    ? `${finalMessageForAPI}\n[${reminderContent}]`
    : finalMessageForAPI;
const messages = [
    { role: 'system', content: characterForAPI.description },
    ...historyForAPI.map(h => ({ role: h.sender === 'ai' ? 'assistant' : 'user', content: h.main })),
    { role: 'user', content: lastUserContent },
];
const fetchUrl = targetApiUrlToSend;
const fetchBody = JSON.stringify({
    model: currentModel,
    messages,
    temperature: parseFloat(currentTemperature),
    top_p: 0.95,
    stream: true,
    ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort, currentModel),
    ...getReplyLengthVerbosityConfig(targetApiUrlToSend, replyLength),
    options: {
        num_ctx: modelSettings?.numCtx || 131072,
        top_p: 0.95
    }
});
const response = await fetch(fetchUrl, {
    method: 'POST',
    headers: isLocal
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeyToSend}` },
    signal: streamSignal,
    body: fetchBody
});

    clearStreamTimers();
            if (response.status === 429) {
                // Waited out with a growing pause, or the one the provider
                // asks for, instead of a request every second. A daily or
                // credit quota is reported straight away: it will not lift in
                // the next minute.
                const limitText = await response.text().catch(() => '');
                rateLimitRetries++;
                const delay = chatRetryDelayMs(rateLimitRetries, response);
                if (isHardQuotaError(limitText) || attempt === MAX_RETRIES
                    || Date.now() - startTime + delay > CHAT_RATE_LIMIT_PATIENCE_MS) {
                    throw new Error(limitText || "AI Model did not respond after multiple retries. Please try again later or choose another Model.");
                }
                if (Date.now() - startTime > 20000 && aiMessageObject.variations[0].main === '...') {
                    bubbleStatus = `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
                    showBubbleStatus(newMessageId, bubbleStatus);
                }
                await waitForRetry(delay, streamSignal);
                continue;
            }
            if (!response.ok) throw new Error((await response.text().catch(() => '')) || `HTTP ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            fullReply = '';
            const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
            reasoningBuf = '';
            let streamError = '';
            let sseBuffer = '';
            const mainTypewriter = createTypewriter();
            const thinkTypewriter = createTypewriter();
            while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';
    const currentMessageElement = document.querySelector(`[data-message-id="${CSS.escape(newMessageId)}"]`);
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
            // A provider that fails after the stream has started reports it as
            // an error object inside the 200 response.
            if (parsed.error) streamError = parsed.error.message || JSON.stringify(parsed.error);
            if (parsed.usage) recordUsageCost(parsed.usage, chat);
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            const reasoningDelta = extractReasoningDelta(delta);
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

                if (streamThinkText !== null && reasoningBuf === '' && ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    thinkBlockEl.open = true;
                    const sanitizedThink = sanitizeModelOutput(streamThinkText);
                    thinkTypewriter.update(sanitizedThink, t => { if (thinkBlockContentEl) { thinkBlockContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
                    if (streamThinkComplete) {
                        aiMessageObject.variations[0].think = sanitizedThink;
                    }
                }
            }
            if (reasoningDelta) {
                reasoningBuf += reasoningDelta;
                if (ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    thinkBlockEl.open = true;
                    const sanitizedReasoning = sanitizeModelOutput(reasoningBuf.trim());
                    thinkTypewriter.update(sanitizedReasoning, t => { if (thinkBlockContentEl) { thinkBlockContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
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

                playSound('reply');
                updateTokenCount();
                if (!streamAbortedByUser && ttsEnabled && finalMainText) {
                    speakText(finalMainText, newMessageId);
                }
                break;
            } else {
                // A mid-stream error with nothing before it is a failure, not
                // an empty answer, and goes to the error handling below.
                if (streamError) throw new Error(streamError);
                emptyReplies++;
                console.log(`Attempt ${attempt} resulted in an empty response.`);
                // Every attempt is billed, so an empty answer is only asked
                // for again a couple of times before the notice below.
                if (emptyReplies >= CHAT_MAX_EMPTY_ATTEMPTS || attempt >= MAX_RETRIES) break;
                await waitForRetry(chatRetryDelayMs(emptyReplies), streamSignal);
            }
        } catch (error) {
    clearStreamTimers();
    if (error.name === 'AbortError') {
        console.log('Fetch aborted (Submit).');
        streamAbortedByUser = true;
        break;
    }
    console.error(`Error on attempt ${attempt}:`, error.message);
    // The connection dropped after part of the reply had already arrived.
    // What arrived is kept: it is on screen, and replacing it with an error
    // notice used to lose it for good on the next reload.
    if (fullReply.trim() !== '' || reasoningBuf.trim() !== '') {
        const partialVariant = aiMessageObject.variations[0];
        if (!partialVariant.main || partialVariant.main === '...') {
            partialVariant.main = sanitizeModelOutput(extractMainFromReasoning(reasoningBuf) || fullReply.replace(/<think>[\s\S]*?<\/think>/i, '').trim());
            keptPartialReply = true;
        }
        if (reasoningBuf.trim()) partialVariant.think = sanitizeModelOutput(reasoningBuf.trim());
        break;
    }
    networkFailures++;
    if (isTemporaryChatError(error) && networkFailures < CHAT_MAX_NETWORK_ATTEMPTS && attempt < MAX_RETRIES) {
        console.log('Request failed or rate-limited. Retrying...');
        await waitForRetry(chatRetryDelayMs(networkFailures), streamSignal);
    } else {
        let errorMsg = `An unexpected error occurred. Please try regenerating the response or start a new chat. If the problem persists, please check the FAQ.`;
        if (isConnectionFailure(error)) {
            errorMsg = "Could not connect to the AI provider. Please check your API key and internet connection, then try again.";
        }
        errorMsg = withProviderDetail(errorMsg, error);
        aiMessageObject.variations[0] = { main: errorMsg, think: null, notice: true };
        playSound('error');
        const freshSendEl = document.querySelector(`[data-message-id="${CSS.escape(newMessageId)}"] .main-content`);
        if(freshSendEl) freshSendEl.innerHTML = formatSubString(errorMsg);
        else if(mainContentEl) mainContentEl.innerHTML = formatSubString(errorMsg);
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
    } else if (!hasAnyReplyContent) {
        const errorMsg = `AI Model did not respond to the request. Please try the following steps:

• Re-enter your default API key (or model-specific API key) in the app settings by copy & paste to ensure that it's correct.
• Check the request limits per minute/per day of the provider you're using, especially in free plans. Connection fails when limits are exceeded.
• Try sending a message again later in case the model is overloaded. Also, use other AI models to see if the AI model itself was the problem.
• In some cases your API provider might have a temporary problem. Try another provider/API key to see if your priveder was the problem.
• Check the FAQ section (help button on main screen) for further details to this error.`;
        aiMessageObject.variations[0] = { main: errorMsg, think: null, notice: true };
        playSound('error');
        if (mainContentEl) mainContentEl.innerHTML = formatSubString(errorMsg);
    } else if (keptPartialReply) {
        updateSingleMessageView(newMessageId);
    }
    // One write for every outcome - a finished reply, a stopped one, a partial
    // one or a notice. A stop used to leave the stored message as '...'.
    try {
        await saveSingleCharacterToDB(mainCharacter);
    } catch (saveError) {
        console.error('Could not save the reply:', saveError);
    }
    if (!streamAbortedByUser || hasAnyReplyContent) {
        const finalMessageEl = document.querySelector(`[data-message-id="${CSS.escape(newMessageId)}"]`);
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
    if (currentStreamController === streamController) currentStreamController = null;
    chatTurnInProgress = false;
    // Not after a stop, and not after a failure either: the bubble then holds
    // the "did not respond" notice, and suggesting replies to that is noise.
    if (!streamAbortedByUser && hasAnyReplyContent) generateReplyOptionsInBackground();
    if (!streamAbortedByUser && hasAnyReplyContent && !isChatNoticeVariant(aiMessageObject.variations[0])) {
        afterAIReply(mainCharacter, chat);
    }
}



async function handleRegenerate(messageId) {
    // Held for the whole request: the user may open another chat while it
    // streams, and the reply must still be saved into this one.
    const ownerCharacter = characters[currentCharacterId];
    const chat = ownerCharacter?.chats?.[currentChatId];
    if (!chat) return;
    const messageIndex = chat.history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;
    // Only after the bail-outs above, or an early return would leave the flag
    // stuck on and suppress reply suggestions for the rest of the session.
    chatTurnInProgress = true;
    // The reply they belong to is about to be rewritten.
    cancelReplyOptions();

let mainContentEl = null;
let thinkBlockEl = null;
let thinkContentEl = null;
let thinkOpened = false;
let isFirstChunk = true;
let sseBuffer = '';
const messageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
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
    let messageType = message.type || 'dialog';
    const storedSpeakerId = message.speakerId || currentCharacterId;
    // World narration (the speaker is the World itself) is always story/narration, even if an
    // older message was stored as 'dialog' — keeps the Character and Narrator buttons aligned.
    if (characters[currentCharacterId]?.type === 'world' && storedSpeakerId === currentCharacterId && messageType === 'dialog') {
        messageType = 'story';
    }
    const speakerId = messageType === 'story' ? currentCharacterId : storedSpeakerId;
    const speakerCharacter = characters[speakerId] || characters[currentCharacterId];
    const charNameForAI = speakerCharacter.chatName || speakerCharacter.name;
    if (messageType === 'story') {
        message.type = 'story';
        delete message.speakerId;
    }

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
    // The request is rebuilt the way this reply was first asked for. After a
    // user message, that message is the prompt and what precedes it the
    // history. After another reply - the send with an empty message box - that
    // reply was the prompt, as in handleChatSubmit. Searching back for the last
    // user message instead dropped every reply in between from the context.
    const promptHistory = historyForPrompt(chat.history.slice(0, messageIndex));
    const precedingMessage = promptHistory[promptHistory.length - 1] || null;
    let userMessageForAPI;
    let historyForAPIcall;
    if (!precedingMessage) {
        userMessageForAPI = "Start the roleplay with a creative, exciting scenario, and introduce the central character in typical manner.";
        historyForAPIcall = [];
    } else if (precedingMessage.sender === 'user') {
        userMessageForAPI = precedingMessage.main;
        historyForAPIcall = promptHistory.slice(0, -1);
    } else {
        const previousText = (precedingMessage.variations?.[precedingMessage.activeVariant]?.main || '').trim();
        userMessageForAPI = (previousText || "Continue the scene plausibly based on the latest turn.")
            + "\n\n(Continue the scene from your previous reply with new content. Do not repeat earlier sentences and drive the scene actively forward.)";
        historyForAPIcall = promptHistory.slice(0, -1);
    }
    const activePersonaId = chat.activePersonaId;
    const persona = activePersonaId ? personas[activePersonaId] : null;
    const currentModelId = modelSelect.value || defaultSettings.model;
    const modelSettings = appSettings.availableModels.find(m => m.id === currentModelId);
    const isMultiChar = chat.participants && chat.participants.length > 1;
    const mappedHistoryForAPI = historyForAPIcall.map(msg => {
    const activePersona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
    if (msg.sender === 'ai') {
        const speaker = characters[msg.speakerId || currentCharacterId];
        const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
        let processedText = applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName);
        processedText = applyUserPlaceholder(processedText, activePersona);
        return { sender: 'ai', main: msg.type === 'story' ? `[Narration] ${processedText}` : (isMultiChar && speaker?.type !== 'world') ? `${speakerName}: ${processedText}` : processedText };
    } else {
        const userName = activePersona?.chatName || activePersona?.name || 'User';
        let processedText = applyUserPlaceholder(msg.main, activePersona);
        return { sender: 'user', main: isMultiChar ? `${userName}: ${processedText}` : processedText };
    }
});

    let messageForAPIRegen = userMessageForAPI;
    // Scanned for keyword-triggered lore, the same window the send path reads.
    const loreScanText = [
        ...mappedHistoryForAPI.slice(-6).map(h => h.main || ''),
        messageForAPIRegen || ''
    ].join('\n');
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
    const isWorldRegenChat = characters[currentCharacterId]?.type === 'world';
    const worldRegenChar = isWorldRegenChat ? characters[currentCharacterId] : null;

    if (modelSettings && modelSettings.instructions && modelSettings.instructions.trim() !== '') {
  fullSystemPrompt += `--- GLOBAL AI INSTRUCTIONS ---\n${
    applyUserPlaceholder(applyCharPlaceholder(modelSettings.instructions.trim(), charNameForAI), persona)
  }\n\n`;
}

    if (persona) {
        fullSystemPrompt += `--- EXACT USER PERSONA ---\nName: ${persona.chatName || persona.name}\nDescription: ${applyUserPlaceholder(applyCharPlaceholder(persona.description, charNameForAI), persona)}\n---\n\n`;
    }

    if (isWorldRegenChat) {
        const worldName = worldRegenChar.name || 'This World';
        if (worldRegenChar.description) fullSystemPrompt += `--- WORLD CONTEXT ---\nWorld: ${worldName}\n${fillPromptPlaceholders(worldRegenChar.description.trim(), charNameForAI, persona)}\n\n`;
        { const loreText = getLoreText(worldRegenChar, loreScanText); if (loreText) fullSystemPrompt += `--- WORLD LORE & HISTORY ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
        if (worldRegenChar.reminder) fullSystemPrompt += `--- WORLD RULES (CRITICAL — THESE RULES MAY NEVER BE BROKEN UNDER ANY CIRCUMSTANCES) ---\n${fillPromptPlaceholders(worldRegenChar.reminder.trim(), charNameForAI, persona)}\n\n`;
        if (speakerId === currentCharacterId || messageType === 'story') {
            fullSystemPrompt += getNarratorMetaInstruction();
            const worldChars = chat.participants.filter(pid => pid !== currentCharacterId);
            if (worldChars.length > 0) {
                fullSystemPrompt += `--- CHARACTERS IN THIS WORLD ---\n`;
                worldChars.forEach(pid => {
                    const pChar = characters[pid];
                    if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
                });
                fullSystemPrompt += `\n`;
            }
        } else {
            if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
            if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${fillPromptPlaceholders(characterForAPI.description.trim(), charNameForAI, persona)}\n\n`;
            { const loreText = getLoreText(characterForAPI, loreScanText); if (loreText) fullSystemPrompt += `--- CHARACTER LORE ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
        }
    } else if (messageType === 'story') {
        fullSystemPrompt += getNarratorMetaInstruction();
        fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
        chat.participants.forEach(pid => {
            const pChar = characters[pid];
            if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
        });
        const mainCharacterForLore = characters[currentCharacterId];
        { const loreText = getLoreText(mainCharacterForLore, loreScanText); if (loreText) fullSystemPrompt += `\n--- LORE / BACKGROUND KNOWLEDGE ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
    } else {
        if (isMultiChar) {
            fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
            chat.participants.forEach(pid => {
                const pChar = characters[pid];
                if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
            });
            fullSystemPrompt += `\n`;
        }
        if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
        if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${fillPromptPlaceholders(characterForAPI.description.trim(), charNameForAI, persona)}\n\n`;
        { const loreText = getLoreText(characterForAPI, loreScanText); if (loreText) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
    }
    fullSystemPrompt += getMoodSystemContext({
        mood: chat.mood,
        characterName: charNameForAI,
        isNarration: isWorldRegenChat || messageType === 'story'
    });
    const chatMemoriesText = getChatMemories(chat);
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${fillPromptPlaceholders(chatMemoriesText, charNameForAI, persona)}\n\n`;
    }
    fullSystemPrompt += getReplyLengthInstruction(replyLength);
    const needsSpeakerExclusivity = messageType === 'dialog' && isMultiChar;
    if (needsSpeakerExclusivity) {
        fullSystemPrompt += getSpeakerExclusivityInstruction(charNameForAI, getOtherSpeakerNames(chat, speakerId));
    }
    characterForAPI.description = fullSystemPrompt;
    const MAX_RETRIES = 90;
    const streamController = new AbortController();
    const streamSignal = streamController.signal;
    currentStreamController = streamController;
    const regenVariantIndex = message.activeVariant;
    let fullReply = '';
    let reasoningBuf = '';
    let newVariant = null;
    let streamAbortedByUser = false;
    let emptyReplies = 0;
    let networkFailures = 0;
    let rateLimitRetries = 0;
    let bubbleStatus = null;
    let regenFailed = false;

const coldStartTimer = setTimeout(() => {
    if (message.variations[regenVariantIndex]?.main === '...') {
        bubbleStatus = "Connecting to AI Model - Please wait or regenerate the message.";
        showBubbleStatus(messageId, bubbleStatus);
    }
}, 20000);

const serverHungTimer = setTimeout(() => {
    if (message.variations[regenVariantIndex]?.main === '...' && bubbleStatus && bubbleStatus.includes("Connecting to AI Model")) {
        bubbleStatus = "The AI provider may be experiencing issues - Please wait a moment or try again later.";
        showBubbleStatus(messageId, bubbleStatus);
    }
}, 70000);

const clearStreamTimers = () => {
    clearTimeout(coldStartTimer);
    clearTimeout(serverHungTimer);
};

const startTime = Date.now();
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (streamSignal.aborted) { streamAbortedByUser = true; break; }
        try {
            console.log(`Regenerate request (Attempt ${attempt}/${MAX_RETRIES})...`);

            const currentModel = modelSelect.value;
            const currentTemperature = temperatureSlider.value;
            const apiKeyToSend = (modelSettings && modelSettings.apiKey) || appSettings.apiKey;
const targetApiUrlToSend = (modelSettings && modelSettings.targetApiUrl) || DEFAULT_API_URL;
const isLocal = targetApiUrlToSend && (
    targetApiUrlToSend.includes('localhost') ||
    targetApiUrlToSend.includes('127.0.0.1') ||
    targetApiUrlToSend.includes('::1') ||
    /^https?:\/\/192\.168\./.test(targetApiUrlToSend) ||
    /^https?:\/\/10\./.test(targetApiUrlToSend) ||
    /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./.test(targetApiUrlToSend)
);

const reminderContent = [
    messageType === 'dialog' ? combinedDialogReminder : combinedNarratorReminder,
    needsSpeakerExclusivity ? getSpeakerExclusivityReminderLine(charNameForAI) : ''
].filter(Boolean).join('\n');
const lastUserContent = reminderContent
    ? `${messageForAPIRegen}\n[${reminderContent}]`
    : messageForAPIRegen;
const messages = [
    { role: 'system', content: characterForAPI.description },
    ...mappedHistoryForAPI.map(h => ({ role: h.sender === 'ai' ? 'assistant' : 'user', content: h.main })),
    { role: 'user', content: lastUserContent },
];
const fetchUrl = targetApiUrlToSend;
const fetchBody = JSON.stringify({
    model: currentModelId,
    messages,
    temperature: parseFloat(currentTemperature),
    top_p: 0.95,
    stream: true,
    ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort, currentModelId),
    ...getReplyLengthVerbosityConfig(targetApiUrlToSend, replyLength),
    options: {
        num_ctx: modelSettings?.numCtx || 131072,
        top_p: 0.95
    }
});
const response = await fetch(fetchUrl, {
    method: 'POST',
    headers: isLocal
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeyToSend}` },
    signal: streamSignal,
    body: fetchBody
});
            clearStreamTimers();
            if (response.status === 429) {
                const limitText = await response.text().catch(() => '');
                rateLimitRetries++;
                const delay = chatRetryDelayMs(rateLimitRetries, response);
                if (isHardQuotaError(limitText) || attempt === MAX_RETRIES
                    || Date.now() - startTime + delay > CHAT_RATE_LIMIT_PATIENCE_MS) {
                    throw new Error(limitText || "AI Model did not respond after multiple retries. Please try again later or choose another Model.");
                }
                if (Date.now() - startTime > 20000 && message.variations[regenVariantIndex]?.main === '...') {
                    bubbleStatus = `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
                    showBubbleStatus(messageId, bubbleStatus);
                }
                await waitForRetry(delay, streamSignal);
                continue;
            }
            if (!response.ok) throw new Error((await response.text().catch(() => '')) || `HTTP ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let mainContentEl = messageElement?.querySelector('.main-content');
            let thinkBlockEl = messageElement?.querySelector('.think-block');
            let thinkBlockContentEl = thinkBlockEl ? thinkBlockEl.querySelector('.think-block-content') : null;
            let isFirstChunk = true
            let sseBuffer = '';
            fullReply = '';
            reasoningBuf = '';
            let streamError = '';
            let thinkOpened = false;
            const mainTypewriter = createTypewriter();
            const thinkTypewriter = createTypewriter();
            while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';
    const currentMessageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
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
            if (parsed.error) streamError = parsed.error.message || JSON.stringify(parsed.error);
            if (parsed.usage) recordUsageCost(parsed.usage, chat);
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            const reasoningDelta = extractReasoningDelta(delta);
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

                if (streamThinkText !== null && reasoningBuf === '' && ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                    const sanitizedThink = sanitizeModelOutput(streamThinkText);
                    thinkTypewriter.update(sanitizedThink, t => { if (thinkContentEl) { thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
                    if (streamThinkComplete) {
                        message.variations[message.activeVariant].think = sanitizedThink;
                        newVariant.think = sanitizedThink;
                    }
                }
            }
            if (reasoningDelta) {
                reasoningBuf += reasoningDelta;
                if (ensureThinkBlockPresent()) {
                    thinkBlockEl.classList.remove('hidden');
                    if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                    const sanitizedReasoning = sanitizeModelOutput(reasoningBuf.trim());
                    thinkTypewriter.update(sanitizedReasoning, t => { if (thinkContentEl) { thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
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

                finalVariant.main = finalMainText;
                finalVariant.think = finalThink;
                newVariant = { main: finalMainText, think: finalThink };

                // Retire the typewriter on the finished text before the reply is announced.
                // Left running it keeps repainting the bubble with a partial slice for as long
                // as it lags the stream, so the notification sound fired while the message still
                // appeared to be typing itself out.
                mainTypewriter.flush(finalMainText || '', t => { if (mainContentEl) mainContentEl.innerHTML = formatSubString(t); });

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
                if (streamError) throw new Error(streamError);
                emptyReplies++;
                console.log(`Attempt ${attempt} resulted in an empty response.`);
                if (emptyReplies >= CHAT_MAX_EMPTY_ATTEMPTS || attempt >= MAX_RETRIES) break;
                await waitForRetry(chatRetryDelayMs(emptyReplies), streamSignal);
            }
} catch (error) {
    clearStreamTimers();
    if (error.name === 'AbortError') {
        console.log('Fetch aborted (Regen).');
        streamAbortedByUser = true;
        break;
    }
    console.error(`Error during regeneration (Attempt ${attempt}):`, error.message);
    // Part of the new reply had already arrived before the connection
    // dropped: keep it rather than replacing it with an error notice.
    if (newVariant || reasoningBuf.trim()) {
        if (!newVariant) newVariant = { main: sanitizeModelOutput(extractMainFromReasoning(reasoningBuf)), think: null };
        if (reasoningBuf.trim()) newVariant.think = sanitizeModelOutput(reasoningBuf.trim());
        break;
    }
    networkFailures++;
    if (isTemporaryChatError(error) && networkFailures < CHAT_MAX_NETWORK_ATTEMPTS && attempt < MAX_RETRIES) {
        console.log('Request failed or rate-limited. Retrying...');
        await waitForRetry(chatRetryDelayMs(networkFailures), streamSignal);
    } else {
        let errorMsg = REGENERATE_NO_RESPONSE_NOTICE;
        if (isConnectionFailure(error)) {
            errorMsg = "Could not connect to the AI provider. Please check your API key and internet connection, then try again.";
        }
        errorMsg = withProviderDetail(errorMsg, error);
        if(mainContentEl) mainContentEl.innerHTML = formatSubString(errorMsg);
        message.variations[regenVariantIndex] = { main: errorMsg, think: null, notice: true };
        playSound('error');
        regenFailed = true;
        break;
    }
}
    }
    clearStreamTimers();
    message.isStreaming = false;
    message.streamingVariant = null;
    setBubbleLoading(mainContentEl, false);
    // Every attempt came back empty: say so instead of leaving a blank variant.
    if (!streamAbortedByUser && !newVariant && !regenFailed) {
        message.variations[regenVariantIndex] = { main: REGENERATE_NO_RESPONSE_NOTICE, think: null, notice: true };
        playSound('error');
    }
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
            playSound('reply');
            updateTokenCount();
        }
    }
    const finalMessageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
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
    if (currentStreamController === streamController) currentStreamController = null;
    chatTurnInProgress = false;
    // newVariant is only set once a reply actually arrived; without it the
    // variant holds an error notice, which is nothing to suggest replies to.
    if (!streamAbortedByUser && newVariant) {
        generateReplyOptionsInBackground();
        afterAIReply(ownerCharacter, chat);
    }
    await saveSingleCharacterToDB(ownerCharacter);
    updateSingleMessageView(messageId);
}



async function handleContinue(messageId) {
    // Held for the whole request, so the continuation is saved into this chat
    // even if the user has opened another one in the meantime.
    const ownerCharacter = characters[currentCharacterId];
    const chat = ownerCharacter?.chats?.[currentChatId];
    if (!chat) return;
    const messageIndex = chat.history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;
    // Only after the bail-outs above, or an early return would leave the flag
    // stuck on and suppress reply suggestions for the rest of the session.
    chatTurnInProgress = true;
    // The reply they belong to is about to grow a new ending.
    cancelReplyOptions();
    // Declared here rather than assigned into the global scope by accident,
    // which is what the abort branch below used to do.
    let streamAbortedByUser = false;

let mainContentEl = null;
let thinkBlockEl = null;
let thinkContentEl = null;
let thinkOpened = false;
let isFirstChunk = true;
let sseBuffer = '';
const messageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
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

    let messageType = message.type || 'dialog';
    const storedSpeakerId = message.speakerId || currentCharacterId;
    // World narration (the speaker is the World itself) is always story/narration, even if an
    // older message was stored as 'dialog' — keeps the Character and Narrator buttons aligned.
    if (characters[currentCharacterId]?.type === 'world' && storedSpeakerId === currentCharacterId && messageType === 'dialog') {
        messageType = 'story';
    }
    const speakerId = messageType === 'story' ? currentCharacterId : storedSpeakerId;
    const speakerCharacter = characters[speakerId] || characters[currentCharacterId];
    const charNameForAI = speakerCharacter.chatName || speakerCharacter.name;
    if (messageType === 'story') {
        message.type = 'story';
        delete message.speakerId;
    }
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

    // Keep the message being continued in its original assistant role. Sending
    // it back as a user message makes models more likely to restart or repeat it.
    const historyCopy = historyForPrompt(chat.history.slice(0, messageIndex)).concat([chat.history[messageIndex]]);
    const messageForAPI = getContinuationInstruction(replyLength);
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

    const isMultiChar = chat.participants && chat.participants.length > 1;
    const historyForAPIcall = historyCopy.map(msg => {
    const activePersona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
    if (msg.sender === 'ai') {
        const speaker = characters[msg.speakerId || currentCharacterId];
        const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
        let processedText = applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName);
        processedText = applyUserPlaceholder(processedText, activePersona);
        return { sender: 'ai', main: msg.type === 'story' ? `[Narration] ${processedText}` : (isMultiChar && speaker?.type !== 'world') ? `${speakerName}: ${processedText}` : processedText };
    } else {
        const userName = activePersona?.chatName || activePersona?.name || 'User';
        let processedText = applyUserPlaceholder(msg.main, activePersona);
        return { sender: 'user', main: isMultiChar ? `${userName}: ${processedText}` : processedText };
    }
});
    // Scanned for keyword-triggered lore: the reply being continued and the
    // turns before it.
    const loreScanText = historyForAPIcall.slice(-7).map(h => h.main || '').join('\n');

    const characterForAPI = { ...speakerCharacter };
    let fullSystemPrompt = '';
    const isWorldContChat = characters[currentCharacterId]?.type === 'world';
    const worldContChar = isWorldContChat ? characters[currentCharacterId] : null;

    if (modelSettings && modelSettings.instructions && modelSettings.instructions.trim() !== '') {
        fullSystemPrompt += `--- GLOBAL AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(modelSettings.instructions.trim(), charNameForAI), persona)}\n\n`;
    }
    if (persona) {
        fullSystemPrompt += `--- EXACT USER PERSONA ---\nName: ${persona.chatName || persona.name}\nDescription: ${applyUserPlaceholder(applyCharPlaceholder(persona.description, charNameForAI), persona)}\n---\n\n`;
    }
    if (isWorldContChat) {
        const worldName = worldContChar.name || 'This World';
        if (worldContChar.description) fullSystemPrompt += `--- WORLD CONTEXT ---\nWorld: ${worldName}\n${fillPromptPlaceholders(worldContChar.description.trim(), charNameForAI, persona)}\n\n`;
        { const loreText = getLoreText(worldContChar, loreScanText); if (loreText) fullSystemPrompt += `--- WORLD LORE & HISTORY ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
        if (worldContChar.reminder) fullSystemPrompt += `--- WORLD RULES (CRITICAL — THESE RULES MAY NEVER BE BROKEN UNDER ANY CIRCUMSTANCES) ---\n${fillPromptPlaceholders(worldContChar.reminder.trim(), charNameForAI, persona)}\n\n`;
        if (speakerId === currentCharacterId || messageType === 'story') {
            fullSystemPrompt += getNarratorMetaInstruction();
            const worldChars = chat.participants.filter(pid => pid !== currentCharacterId);
            if (worldChars.length > 0) {
                fullSystemPrompt += `--- CHARACTERS IN THIS WORLD ---\n`;
                worldChars.forEach(pid => {
                    const pChar = characters[pid];
                    if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
                });
                fullSystemPrompt += `\n`;
            }
        } else {
            if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
            if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${fillPromptPlaceholders(characterForAPI.description.trim(), charNameForAI, persona)}\n\n`;
            { const loreText = getLoreText(characterForAPI, loreScanText); if (loreText) fullSystemPrompt += `--- CHARACTER LORE ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
        }
    } else if (messageType === 'story') {
        fullSystemPrompt += getNarratorMetaInstruction();
        fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
        chat.participants.forEach(pid => {
            const pChar = characters[pid];
            if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
        });
        const mainCharacterForLore = characters[currentCharacterId];
        { const loreText = getLoreText(mainCharacterForLore, loreScanText); if (loreText) fullSystemPrompt += `\n--- LORE / BACKGROUND KNOWLEDGE ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
    } else {
        if (isMultiChar) {
            fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
            chat.participants.forEach(pid => {
                const pChar = characters[pid];
                if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description ? fillPromptPlaceholders(pChar.description, pChar.chatName || pChar.name, persona) : 'No description available.'}\n---\n`;
            });
            fullSystemPrompt += `\n`;
        }
        if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
        if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${fillPromptPlaceholders(characterForAPI.description.trim(), charNameForAI, persona)}\n\n`;
        { const loreText = getLoreText(characterForAPI, loreScanText); if (loreText) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${fillPromptPlaceholders(loreText, charNameForAI, persona)}\n\n`; }
    }
    fullSystemPrompt += getMoodSystemContext({
        mood: chat.mood,
        characterName: charNameForAI,
        isNarration: isWorldContChat || messageType === 'story'
    });
    const chatMemoriesText = getChatMemories(chat);
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${fillPromptPlaceholders(chatMemoriesText, charNameForAI, persona)}\n\n`;
    }
    fullSystemPrompt += getReplyLengthInstruction(replyLength);
    const needsSpeakerExclusivity = messageType === 'dialog' && isMultiChar;
    if (needsSpeakerExclusivity) {
        fullSystemPrompt += getSpeakerExclusivityInstruction(charNameForAI, getOtherSpeakerNames(chat, speakerId));
    }
    characterForAPI.description = fullSystemPrompt;

    const MAX_RETRIES = 90;
    const streamController = new AbortController();
    const streamSignal = streamController.signal;
    currentStreamController = streamController;
    let fullReply = '';
    let reasoningBuf = '';
    let emptyReplies = 0;
    let networkFailures = 0;
    let rateLimitRetries = 0;
    let bubbleStatus = null;
    // An error is shown under the kept text once the view has been redrawn.
    let continueErrorText = null;
const startTime = Date.now();
// Status lines are shown in the bubble only, never written into the message.
const coldStartTimer = setTimeout(() => {
    if (activeVariant.main === originalText) {
        bubbleStatus = "Connecting to AI Model - Please wait or regenerate the message.";
        showBubbleStatus(messageId, originalText + " " + bubbleStatus);
    }
}, 20000);
const serverHungTimer = setTimeout(() => {
    if (activeVariant.main === originalText && bubbleStatus && bubbleStatus.includes("Connecting to AI Model")) {
        bubbleStatus = "The AI provider may be experiencing issues - Please wait a moment or try again later.";
        showBubbleStatus(messageId, originalText + " " + bubbleStatus);
    }
}, 70000);

const clearStreamTimers = () => {
    clearTimeout(coldStartTimer);
    clearTimeout(serverHungTimer);
};
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (streamSignal.aborted) { streamAbortedByUser = true; break; }
        try {
            console.log(`Continue request (Attempt ${attempt}/${MAX_RETRIES})...`);

            const currentModel = modelSelect.value;
            const currentTemperature = temperatureSlider.value;
            const apiKeyToSend = (modelSettings && modelSettings.apiKey) || appSettings.apiKey;
const targetApiUrlToSend = (modelSettings && modelSettings.targetApiUrl) || DEFAULT_API_URL;
const isLocal = targetApiUrlToSend && (
    targetApiUrlToSend.includes('localhost') ||
    targetApiUrlToSend.includes('127.0.0.1') ||
    targetApiUrlToSend.includes('::1') ||
    /^https?:\/\/192\.168\./.test(targetApiUrlToSend) ||
    /^https?:\/\/10\./.test(targetApiUrlToSend) ||
    /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./.test(targetApiUrlToSend)
);

const reminderContent = [
    messageType === 'dialog' ? combinedDialogReminder : combinedNarratorReminder,
    needsSpeakerExclusivity ? getSpeakerExclusivityReminderLine(charNameForAI) : ''
].filter(Boolean).join('\n');
const lastUserContent = reminderContent
    ? `${messageForAPI}\n[${reminderContent}]`
    : messageForAPI;
const messages = [
    { role: 'system', content: characterForAPI.description },
    ...historyForAPIcall.map(h => ({ role: h.sender === 'ai' ? 'assistant' : 'user', content: h.main })),
    { role: 'user', content: lastUserContent },
];
const fetchUrl = targetApiUrlToSend;
const fetchBody = JSON.stringify({
    model: currentModelId,
    messages,
    temperature: parseFloat(currentTemperature),
    top_p: 0.95,
    stream: true,
    ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort, currentModelId),
    ...getReplyLengthVerbosityConfig(targetApiUrlToSend, replyLength),
    options: {
        num_ctx: modelSettings?.numCtx || 131072,
        top_p: 0.95
    }
});
const response = await fetch(fetchUrl, {
    method: 'POST',
    headers: isLocal
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeyToSend}` },
    signal: streamSignal,
    body: fetchBody
});
            clearStreamTimers();

            if (response.status === 429) {
    const limitText = await response.text().catch(() => '');
    rateLimitRetries++;
    const delay = chatRetryDelayMs(rateLimitRetries, response);
    if (isHardQuotaError(limitText) || attempt === MAX_RETRIES
        || Date.now() - startTime + delay > CHAT_RATE_LIMIT_PATIENCE_MS) {
        throw new Error(limitText || "AI Model did not respond after multiple retries. Please try again later or choose another Model.");
    }
    if (Date.now() - startTime > 20000 && activeVariant.main === originalText) {
        bubbleStatus = `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
        showBubbleStatus(messageId, originalText + " " + bubbleStatus);
    }
    await waitForRetry(delay, streamSignal);
    continue;
}
            if (!response.ok) throw new Error((await response.text().catch(() => '')) || `HTTP ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = '';
            fullReply = '';
            reasoningBuf = '';
            let streamError = '';
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
                const currentMessageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
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
                        if (parsed.error) streamError = parsed.error.message || JSON.stringify(parsed.error);
                        if (parsed.usage) recordUsageCost(parsed.usage, chat);
                        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
                        const reasoningDelta = extractReasoningDelta(delta);

                        if (isFirstChunk && (delta?.content || reasoningDelta)) {
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

                            const combinedTextRaw = mergeContinuationText(originalText, mainOnly);
                            const sanitizedCombined = sanitizeModelOutput(combinedTextRaw);
                            mainTypewriter.update(sanitizedCombined, t => { if (mainContentEl) { mainContentEl.innerHTML = formatSubString(t); if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
                            activeVariant.main = sanitizedCombined;

                            if (streamThinkText !== null && reasoningBuf === '' && ensureThinkBlockPresent()) {
                                thinkBlockEl.classList.remove('hidden');
                                if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                                const sanitizedThink = sanitizeModelOutput(streamThinkText);
                                thinkTypewriter.update(sanitizedThink, t => { if (thinkContentEl) { thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
                                if (streamThinkComplete) {
                                    activeVariant.think = sanitizedThink;
                                }
                            }
                        }
                        if (reasoningDelta) {
                           reasoningBuf += reasoningDelta;
                           if (ensureThinkBlockPresent()) {
                               const sanitizedReasoning = sanitizeModelOutput(reasoningBuf.trim());
                               thinkBlockEl.classList.remove('hidden');
                               if (!thinkOpened) { thinkBlockEl.open = true; thinkOpened = true; }
                               thinkTypewriter.update(sanitizedReasoning, t => { if (thinkContentEl) { thinkContentEl.innerHTML = `&lt;think&gt;<br>${formatSubString(t)}<br>&lt;/think&gt;`; if (chatWindow._autoScroll !== false) chatWindow.scrollTop = chatWindow.scrollHeight; } });
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
                const combinedFinalRaw = mergeContinuationText(originalText, mainOnly);
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
    const combinedTail = mergeContinuationText(originalText, mainTail);
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
    const combinedTail = mergeContinuationText(originalText, mainTail);
    activeVariant.main = sanitizeModelOutput(combinedTail);
  }
}
                if ((!mainOnly || mainOnly.trim() === '') && reasoningMainFallback) {
                    const combinedFallback = mergeContinuationText(originalText, reasoningMainFallback);
                    activeVariant.main = sanitizeModelOutput(combinedFallback);
                }

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
                // Same as regeneration: finish the typewriter first, or the sound announces a
                // reply whose bubble is still visibly typing.
                mainTypewriter.flush(activeVariant.main || '', t => { if (mainContentEl) mainContentEl.innerHTML = formatSubString(t); });
                playSound('reply');
                updateTokenCount();
                break;
            } else {
                if (streamError) throw new Error(streamError);
                emptyReplies++;
                if (emptyReplies >= CHAT_MAX_EMPTY_ATTEMPTS || attempt >= MAX_RETRIES) {
                    continueErrorText = CONTINUE_NO_RESPONSE_NOTICE;
                    break;
                }
                await waitForRetry(chatRetryDelayMs(emptyReplies), streamSignal);
            }

        } catch (error) {
            clearStreamTimers();
            if (error.name === 'AbortError') {
                console.log('Fetch aborted (Continue).');
                streamAbortedByUser = true;
                break;
    }
    console.error(`Error during continue (Attempt ${attempt}):`, error.message);
    // The continuation that already arrived stays; it is merged into the
    // message and on screen.
    if (fullReply.trim() !== '' || reasoningBuf.trim() !== '') break;
    networkFailures++;
    if (isTemporaryChatError(error) && networkFailures < CHAT_MAX_NETWORK_ATTEMPTS && attempt < MAX_RETRIES) {
        await waitForRetry(chatRetryDelayMs(networkFailures), streamSignal);
    } else {
        let errorMsg = CONTINUE_NO_RESPONSE_NOTICE;
        if (isConnectionFailure(error)) {
            errorMsg = "Could not connect to the AI provider. Please check your API key and internet connection, then try again.";
        }
        continueErrorText = withProviderDetail(errorMsg, error);
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
    if (currentStreamController === streamController) currentStreamController = null;
    chatTurnInProgress = false;
    if (!streamAbortedByUser && !continueErrorText) {
        generateReplyOptionsInBackground();
        afterAIReply(ownerCharacter, chat);
    }
    await saveSingleCharacterToDB(ownerCharacter);
    updateSingleMessageView(messageId);
    // Shown after the redraw above, which used to paint over it at once, so a
    // failed continue looked like nothing had happened. It is not saved into
    // the message: the text being continued is left exactly as it was.
    if (continueErrorText) {
        playSound('error');
        const errorContentEl = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"] .main-content`);
        if (errorContentEl) {
            const sanitizedError = sanitizeModelOutput(`${activeVariant.main}\n\n[--- ERROR: ${continueErrorText} ---]`);
            errorContentEl.innerHTML = formatSubString(sanitizedError);
        }
    }

    const finalMessageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
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

    const messageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
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

    if (message.sender === 'ai') {
        renderVariationImages(messageElement, activeVariant, message);
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
    if (charGenAbortController) { charGenAbortController.abort(); charGenAbortController = null; }
    const genBtn = document.getElementById('ai-generate-char-btn');
    if (genBtn) { genBtn.textContent = cardTypeWorldRadio.checked ? '✨ AI Generate World' : '✨ AI Generate Character'; genBtn.disabled = false; }
    document.getElementById('card-name').style.height = 'auto';
    tempUploadedImages = {};
    resetEditorGallery([]);
    hideTagSuggestions();
    characterEditorModalContent.scrollTop = 0;
    characterEditorModal.classList.add('hidden');
}



    function updateEditorForType(type) {
    const isWorld = type === 'world';
    editorAvatarPlaceholder.textContent = isWorld ? '🌍' : '👤';
    editorAvatarUrlGroup.classList.toggle('hidden', isWorld);
    worldCharPickerSection.classList.toggle('hidden', !isWorld);
    typeOptionCharacter.classList.toggle('is-active', !isWorld);
    typeOptionWorld.classList.toggle('is-active', isWorld);
    document.querySelector('.editor-header h2').textContent = isWorld ? 'World Editor' : 'Character Editor';
    document.getElementById('save-edit-btn-top').textContent = isWorld ? 'Save World' : 'Save Character';
    document.getElementById('save-edit-btn-bottom').textContent = isWorld ? 'Save World' : 'Save Character';
    document.getElementById('char-reminder-label').textContent = isWorld ? 'World Rules:' : 'Character Reminder:';
    const galleryHintEl = document.getElementById('editor-gallery-hint');
    if (galleryHintEl) galleryHintEl.textContent = isWorld
        ? 'Tap an image to set it as background.'
        : 'Tap an image to set it as avatar or background.';
    document.getElementById('char-description-label').textContent = isWorld ? 'World Description:' : 'Character Description:';
    const genBtn = document.getElementById('ai-generate-char-btn');
    if (genBtn) genBtn.textContent = isWorld ? '✨ AI Generate World' : '✨ AI Generate Character';
    document.getElementById('card-name').placeholder = isWorld
        ? "e.g., 'The Iron Reaches - Steampunk Empire'"
        : "e.g., 'Natsuki Subaru - Re:Zero'";
    document.getElementById('chat-name').placeholder = "e.g., 'Subaru'";
    const chatNameGroup = document.getElementById('chat-name-group');
    const chatNameInput = document.getElementById('chat-name');
    if (chatNameGroup) chatNameGroup.classList.toggle('hidden', isWorld);
    if (chatNameInput) {
        chatNameInput.required = !isWorld;
        if (isWorld) chatNameInput.value = '';
    }
    document.getElementById('char-description').placeholder = isWorld
        ? 'Setting overview, geography, atmosphere, society, factions, tone etc.'
        : 'Identity, Appearance, Personality, Abilities, Speech Style, Dialog Examples etc.';
    document.getElementById('char-lore').placeholder = isWorld
        ? 'Historical events, myths, creation stories, notable conflicts, secrets of this world etc.'
        : 'Deeper Background Story, World & Relationships of the Character, Fun Facts etc.';
    const instrContainer = document.getElementById('char-instructions-container');
    if (instrContainer) instrContainer.style.display = isWorld ? 'none' : '';
    document.getElementById('char-instructions').placeholder = "General AI Instructions for this character... (e.g., 'Be creative and drive the plot forward.')";
    document.getElementById('char-reminder').placeholder = isWorld
        ? "World rules the AI must always follow... (e.g., 'Magic is forbidden by law.')"
        : "Character Reminder for this character... (e.g., 'Reply only as {{char}} now.')";
    document.getElementById('char-narrator-reminder').placeholder = isWorld
        ? "Narrator Reminder... (e.g., 'Switch to third-person narrator voice now.')"
        : "Narrator Reminder for this character... (e.g., 'Reply only as an omniscient narrator now.')";
    const loreLabelEl = document.querySelector('label[for="char-lore"]');
    if (loreLabelEl) loreLabelEl.textContent = isWorld ? 'World Lore:' : 'Lorebook:';
    const instrLabelEl = document.querySelector('label[for="char-instructions"]');
    if (instrLabelEl) instrLabelEl.textContent = 'AI Instructions:';
    const narrReminderLabelEl = document.querySelector('label[for="char-narrator-reminder"]');
    if (narrReminderLabelEl) narrReminderLabelEl.textContent = isWorld ? 'World Narrator Reminder:' : 'Narrator Reminder:';
    if (isWorld) {
        renderWorldCharSelectedAvatars();
    }
}

function renderWorldCharSelectedAvatars() {
    const container = document.getElementById('world-char-selected-avatars');
    if (!container) return;
    container.innerHTML = '';
    if (worldCharSelectedIds.size === 0) {
        const empty = document.createElement('span');
        empty.className = 'world-char-selected-empty';
        empty.textContent = 'No characters selected';
        container.appendChild(empty);
        return;
    }
    worldCharSelectedIds.forEach(id => {
        const char = characters[id];
        if (!char) return;
        const avatarUrl = getImageUrl(char.avatar);
        const wrap = document.createElement('div');
        wrap.title = char.name;
        if (avatarUrl) {
            const img = document.createElement('img');
            img.src = avatarUrl;
            img.alt = char.name;
            img.onerror = function() { this.style.display = 'none'; const ph = this.nextElementSibling; if (ph) ph.classList.remove('hidden'); };
            const ph = document.createElement('div');
            ph.className = 'placeholder-icon hidden';
            ph.textContent = '👤';
            wrap.appendChild(img);
            wrap.appendChild(ph);
        } else {
            const ph = document.createElement('div');
            ph.className = 'placeholder-icon';
            ph.textContent = '👤';
            wrap.appendChild(ph);
        }
        container.appendChild(wrap);
    });
}

function openWorldCharPickerModal() {
    worldCharPickerTempIds = new Set(worldCharSelectedIds);
    let modal = document.getElementById('worldCharPickerModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'worldCharPickerModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;justify-content:center;align-items:center;z-index:2200;';
        const panel = document.createElement('div');
        panel.className = 'modal-content';
        panel.style.cssText = 'max-width:600px;width:min(600px,92vw);';
        panel.innerHTML = `
          <h2>Add / Remove Characters</h2>
          <p>Choose the characters for this world:</p>
          <div class="modal-search-container" style="display:flex;align-items:center;gap:10px;">
            <input type="search" id="worldCharPickerSearch" class="modal-search-input" placeholder="🔎 Search Character…">
            <label style="display:flex;align-items:center;gap:6px;font-size:16px;color:#dcddde;">
              <input id="worldCharPickerSelectAll" type="checkbox">
              <span>Select all</span>
            </label>
          </div>
          <div id="worldCharPickerList" style="display:flex;flex-direction:column;gap:10px;max-height:50vh;overflow-y:auto;padding-right:10px;"></div>
          <div class="form-buttons">
            <button type="button" id="worldCharPickerConfirmBtn">Confirm</button>
            <button type="button" id="worldCharPickerCancelBtn">Cancel</button>
          </div>
        `;
        modal.appendChild(panel);
        document.body.appendChild(modal);
        panel.querySelector('#worldCharPickerConfirmBtn').addEventListener('click', () => {
            worldCharSelectedIds = new Set(worldCharPickerTempIds);
            modal.style.display = 'none';
            renderWorldCharSelectedAvatars();
        });
        panel.querySelector('#worldCharPickerCancelBtn').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        panel.querySelector('#worldCharPickerSearch').addEventListener('input', renderWorldCharPickerModalList);
        panel.querySelector('#worldCharPickerSelectAll').addEventListener('change', (e) => {
            const boxes = document.querySelectorAll('#worldCharPickerList .worldCharPickerCheckbox');
            boxes.forEach(cb => {
                cb.checked = e.target.checked;
                if (e.target.checked) worldCharPickerTempIds.add(cb.value);
                else worldCharPickerTempIds.delete(cb.value);
            });
            updateWorldCharPickerSelectAll();
        });
    }
    renderWorldCharPickerModalList();
    modal.style.display = 'flex';
}

function renderWorldCharPickerModalList() {
    const list = document.getElementById('worldCharPickerList');
    if (!list) return;
    const q = (document.getElementById('worldCharPickerSearch')?.value || '').toLowerCase().trim();
    const editingId = editingCharField.value;
    const chars = Object.values(characters)
        .filter(c => c.type !== 'world' && c.id !== editingId && (!q || (c.name || '').toLowerCase().includes(q)))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    list.innerHTML = '';
    if (chars.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:10px;color:rgba(255,255,255,0.4);font-style:italic;text-align:center;';
        empty.textContent = 'No characters found.';
        list.appendChild(empty);
        updateWorldCharPickerSelectAll();
        return;
    }
    chars.forEach(char => {
        const avatarSrc = char.avatar ? getImageUrl(char.avatar) : null;
        const avatarHtml = `<img src="${escapeHtml(avatarSrc || '')}" alt="Avatar" class="${avatarSrc ? '' : 'hidden'}" onerror="this.style.display='none';this.nextElementSibling.classList.remove('hidden');"><div class="placeholder-icon ${avatarSrc ? 'hidden' : ''}">👤</div>`;
        const row = document.createElement('label');
        row.className = 'participant-option-btn';
        row.style.cssText = 'justify-content:space-between;width:100%;box-sizing:border-box;';
        const left = document.createElement('div');
        left.style.cssText = 'display:flex;align-items:center;gap:15px;';
        left.innerHTML = `${avatarHtml}<span>${escapeHtml(char.name || '(unnamed)')}</span>`;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'worldCharPickerCheckbox bulkCharCheckbox';
        cb.value = char.id;
        cb.checked = worldCharPickerTempIds.has(char.id);
        cb.addEventListener('change', (e) => {
            if (e.target.checked) worldCharPickerTempIds.add(char.id);
            else worldCharPickerTempIds.delete(char.id);
            updateWorldCharPickerSelectAll();
        });
        row.appendChild(left);
        row.appendChild(cb);
        list.appendChild(row);
    });
    list.querySelectorAll('img').forEach(img => {
        img.style.objectFit = 'cover';
        img.style.objectPosition = 'center';
    });
    updateWorldCharPickerSelectAll();
}

function updateWorldCharPickerSelectAll() {
    const selectAll = document.getElementById('worldCharPickerSelectAll');
    if (!selectAll) return;
    const boxes = document.querySelectorAll('#worldCharPickerList .worldCharPickerCheckbox');
    const total = boxes.length;
    const selected = Array.from(boxes).filter(cb => cb.checked).length;
    selectAll.indeterminate = selected > 0 && selected < total;
    selectAll.checked = total > 0 && selected === total;
}

cardTypeCharacterRadio.addEventListener('change', () => updateEditorForType('character'));
cardTypeWorldRadio.addEventListener('change', () => { worldCharSelectedIds = new Set(); updateEditorForType('world'); });
document.getElementById('open-world-char-picker-btn').addEventListener('click', openWorldCharPickerModal);

    // --- TAG EDITOR (bubbles + suggestion popup) ---

    const tagEditorEl = document.getElementById('tag-editor');
    const tagEditorBox = document.getElementById('tag-editor-box');
    const tagInputEl = document.getElementById('tag-input');
    const tagHiddenField = document.getElementById('char-tags');
    const tagSuggestionsEl = document.getElementById('tag-suggestions');
    const tagSuggestionsSearch = document.getElementById('tag-suggestions-search');
    const tagSuggestionsList = document.getElementById('tag-suggestions-list');

    function parseTagString(str) {
        return (str || '').split(',').map(t => t.trim()).filter(t => t !== '');
    }

    function getEditorTags() {
        return parseTagString(tagHiddenField.value);
    }

    function setEditorTags(tags) {
        const seen = new Set();
        const clean = [];
        tags.forEach(t => {
            const trimmed = String(t).trim();
            const key = trimmed.toLowerCase();
            if (!trimmed || seen.has(key)) return;
            seen.add(key);
            clean.push(trimmed);
        });
        tagHiddenField.value = clean.join(', ');
        renderTagBubbles();
        updateEditorTokenCount();
    }

    function renderTagBubbles() {
        tagEditorBox.querySelectorAll('.tag-bubble').forEach(el => el.remove());
        getEditorTags().forEach(tag => {
            const bubble = document.createElement('span');
            bubble.className = 'tag-bubble';
            const text = document.createElement('span');
            text.className = 'tag-bubble-text';
            text.textContent = tag;
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'tag-bubble-remove';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove tag';
            removeBtn.addEventListener('mousedown', (e) => e.preventDefault());
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeEditorTag(tag);
            });
            bubble.appendChild(text);
            bubble.appendChild(removeBtn);
            tagEditorBox.insertBefore(bubble, tagInputEl);
        });
    }

    function refreshTagEditorFromField() {
        if (!tagEditorBox) return;
        tagInputEl.value = '';
        renderTagBubbles();
    }

    function addEditorTag(tag) {
        const clean = String(tag).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
        if (!clean) return;
        setEditorTags([...getEditorTags(), clean]);
    }

    function removeEditorTag(tag) {
        const key = String(tag).trim().toLowerCase();
        setEditorTags(getEditorTags().filter(t => t.toLowerCase() !== key));
        if (!tagSuggestionsEl.classList.contains('hidden')) renderTagSuggestionsList();
    }

    function commitPendingTagInput() {
        if (tagInputEl && tagInputEl.value.trim() !== '') {
            addEditorTag(tagInputEl.value);
            tagInputEl.value = '';
        }
    }

    function collectAllKnownTags() {
        const seen = new Map();
        const collect = (tag) => {
            const key = tag.toLowerCase();
            if (!seen.has(key)) seen.set(key, tag);
        };
        Object.values(characters).forEach(char => parseTagString(char.tags).forEach(collect));
        getEditorTags().forEach(collect);
        return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function renderTagSuggestionsList() {
        const prevScroll = tagSuggestionsList.scrollTop;
        const filter = tagSuggestionsSearch.value.trim().toLowerCase();
        const current = new Set(getEditorTags().map(t => t.toLowerCase()));
        tagSuggestionsList.innerHTML = '';
        const matches = collectAllKnownTags().filter(tag => !filter || tag.toLowerCase().includes(filter));
        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tag-suggestions-empty';
            empty.textContent = filter
                ? 'No matching tags.'
                : 'No saved tags yet — type into the field and press Enter to add one.';
            tagSuggestionsList.appendChild(empty);
            return;
        }
        matches.forEach(tag => {
            const isSelected = current.has(tag.toLowerCase());
            const item = document.createElement('div');
            item.className = 'tag-suggestion-item' + (isSelected ? ' is-selected' : '');
            item.textContent = tag;
            item.title = isSelected ? 'Remove this tag' : 'Add this tag';
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isSelected) {
                    removeEditorTag(tag);
                } else {
                    addEditorTag(tag);
                }
                renderTagSuggestionsList();
            });
            tagSuggestionsList.appendChild(item);
        });
        tagSuggestionsList.scrollTop = prevScroll;
    }

    function showTagSuggestions() {
        renderTagSuggestionsList();
        tagSuggestionsEl.classList.remove('hidden');
    }

    function hideTagSuggestions() {
        if (tagSuggestionsEl) tagSuggestionsEl.classList.add('hidden');
    }

    if (tagEditorEl) {
        tagEditorBox.addEventListener('click', (e) => {
            if (e.target === tagEditorBox) tagInputEl.focus();
        });

        const openSuggestionsFromInput = () => {
            tagSuggestionsSearch.value = tagInputEl.value;
            showTagSuggestions();
        };
        tagInputEl.addEventListener('focus', openSuggestionsFromInput);
        tagInputEl.addEventListener('click', openSuggestionsFromInput);
        tagInputEl.addEventListener('input', openSuggestionsFromInput);

        tagInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitPendingTagInput();
                tagSuggestionsSearch.value = '';
                renderTagSuggestionsList();
            } else if (e.key === 'Backspace' && tagInputEl.value === '') {
                const tags = getEditorTags();
                if (tags.length > 0) removeEditorTag(tags[tags.length - 1]);
            } else if (e.key === 'Escape') {
                hideTagSuggestions();
            }
        });

        tagSuggestionsSearch.addEventListener('input', renderTagSuggestionsList);
        tagSuggestionsSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const term = tagSuggestionsSearch.value.trim();
                const firstMatch = tagSuggestionsList.querySelector('.tag-suggestion-item:not(.is-selected)');
                if (firstMatch) {
                    addEditorTag(firstMatch.textContent);
                } else if (term) {
                    addEditorTag(term);
                }
                renderTagSuggestionsList();
            } else if (e.key === 'Escape') {
                hideTagSuggestions();
            }
        });

        document.getElementById('tag-suggestions-exit').addEventListener('click', () => {
            commitPendingTagInput();
            hideTagSuggestions();
        });

        document.addEventListener('mousedown', (e) => {
            if (!tagSuggestionsEl.classList.contains('hidden') && !tagEditorEl.contains(e.target)) {
                hideTagSuggestions();
            }
        });

        tagEditorEl.addEventListener('focusout', () => {
            setTimeout(() => {
                if (!tagEditorEl.contains(document.activeElement)) {
                    commitPendingTagInput();
                    hideTagSuggestions();
                }
            }, 0);
        });
    }


    function openEditorForNew() {
    tempUploadedImages = {};
    resetEditorGallery([]);
    characterForm.reset();
    refreshTagEditorFromField();
    cardTypeCharacterRadio.checked = true;
    updateEditorForType('character');
    const textareas = characterForm.querySelectorAll('textarea');
    textareas.forEach(ta => {
        ta.style.height = 'auto';
        ta.style.overflowY = 'hidden';
    });
    document.getElementById('scenario-editor-list').innerHTML = '';
    createScenarioInput({ name: 'Main Greeting', greeting: '' });
    document.getElementById('lore-editor-list').innerHTML = '';
    const flatLoreRadio = document.querySelector('input[name="lore-mode"][value="flat"]');
    if (flatLoreRadio) flatLoreRadio.checked = true;
    updateEditorForLoreMode('flat');
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

  const charType = character.type || 'character';
  const isWorld = charType === 'world';
  if (isWorld) {
      cardTypeWorldRadio.checked = true;
  } else {
      cardTypeCharacterRadio.checked = true;
  }
  worldCharSelectedIds = new Set(character.characterIds || []);
  resetEditorGallery(normalizeGallery(character.gallery));
  updateEditorForType(charType);

  const avatarUrl = getImageUrl(character.avatar);
  const backgroundUrl = getImageUrl(character.background);
  const editorAvatarContainer = editorAvatarImg.parentElement;

  const editorDisplayUrl = isWorld ? backgroundUrl : avatarUrl;
if (editorDisplayUrl) {
    editorAvatarImg.src = editorDisplayUrl;
    smartObjectFit(editorAvatarImg);
    editorAvatarImg.classList.remove('hidden');
    editorAvatarPlaceholder.classList.add('hidden');
    editorAvatarContainer.classList.add('effect-container');
    editorAvatarContainer.style.backgroundImage = cssUrl(editorDisplayUrl);
} else {
    editorAvatarImg.src = '';
    editorAvatarImg.classList.add('hidden');
    editorAvatarPlaceholder.classList.remove('hidden');
    editorAvatarContainer.classList.remove('effect-container');
    editorAvatarContainer.style.backgroundImage = 'none';
}

  document.getElementById('card-name').value = character.name || '';
  document.getElementById('chat-name').value = isWorld ? '' : (character.chatName || character.name || '');
  document.getElementById('char-avatar').value = avatarUrl;
  document.getElementById('char-background').value = backgroundUrl;
  document.getElementById('chat-list-screen').style.backgroundImage = backgroundUrl ? cssUrl(backgroundUrl) : 'none';
  charInstructionsInput.value = character.instructions || '';
  charDescriptionInput.value = character.description || '';
  charLoreInput.value = character.lore || '';
  document.getElementById('char-tags').value = character.tags || '';
  refreshTagEditorFromField();
  document.getElementById('char-reminder').value = character.reminder || '';
  document.getElementById('char-narrator-reminder').value = character.narratorReminder || '';
  document.getElementById('char-music-url').value = character.musicUrl || '';

  const scenarioListDiv = document.getElementById('scenario-editor-list');
  scenarioListDiv.innerHTML = '';
  character.scenarios = normalizeScenarioList(character.scenarios);
  if (character.scenarios.length > 0) {
      character.scenarios.forEach(scenario => createScenarioInput(scenario));
  } else {
      createScenarioInput({ name: '', greeting: '' });
  }

  const loreMode = character.loreMode || 'flat';
  const loreModeRadio = document.querySelector(`input[name="lore-mode"][value="${CSS.escape(loreMode)}"]`);
  if (loreModeRadio) loreModeRadio.checked = true;
  const loreListDiv = document.getElementById('lore-editor-list');
  loreListDiv.innerHTML = '';
  if (Array.isArray(character.loreEntries) && character.loreEntries.length > 0) {
      character.loreEntries.forEach(createLoreEntryInput);
  } else {
      createLoreEntryInput({});
  }
  updateEditorForLoreMode(loreMode);

  editingCharField.value = currentCharacterId;
  updateEditorTokenCount();
  
  characterEditorModal.classList.remove('hidden');

  setTimeout(() => {
    const textareasToResize = [
      'card-name', 'char-instructions', 'char-description', 'char-lore',
      'char-reminder', 'char-narrator-reminder', 'char-music-url'
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

    const copyNoun = originalCharacter.type === 'world' ? 'world' : 'character';

    if (await showCustomConfirm(`Do you really want to copy the ${copyNoun} "${originalCharacter.name}"?`)) {

        const newCharacter = JSON.parse(JSON.stringify(originalCharacter));

        newCharacter.id = 'char-' + Date.now();
        newCharacter.name = originalCharacter.name + " (Copy)";
        newCharacter.chats = {};

        characters[newCharacter.id] = newCharacter;

        await saveSingleCharacterToDB(newCharacter);
        renderCharacterList();
        showCustomAlert(`${copyNoun.charAt(0).toUpperCase() + copyNoun.slice(1)} "${originalCharacter.name}" was successfully copied!`);
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
    updateChatReplyControls();
    messageInput.focus();
}

function clearActiveGroupParticipant() {
    activeGroupParticipantId = null;
    groupCharBubble.classList.add('hidden');
    groupCharBubbleName.textContent = '';
    updateChatReplyControls();
}



function openParticipantModal(searchTerm = '') {
  participantSelectionList.innerHTML = '';
  const currentParticipants = characters[currentCharacterId]?.chats?.[currentChatId]?.participants || [];

  const sortedCharacters = Object.values(characters).sort((a, b) => {
    return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
  });

  const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();
  const filteredCharacters = sortedCharacters.filter(char =>
    char.type !== 'world' && char.name.toLowerCase().includes(lowerCaseSearchTerm)
  );

  filteredCharacters.forEach(char => {
    if (!currentParticipants.includes(char.id)) {
      const btn = document.createElement('button');
      btn.className = 'participant-option-btn';
      btn.dataset.charId = char.id;

      const imageUrl = getImageUrl(char.avatar);
const avatarHtml = `
    <img src="${escapeHtml(imageUrl)}" class="${char.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
    <div class="placeholder-icon ${char.avatar ? 'hidden' : ''}">👤</div>
`;

      btn.innerHTML = `${avatarHtml} <span>${escapeHtml(char.name)}</span>`;

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
    playSound('swap');
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
    <img src="${escapeHtml(imageUrl)}" class="${persona.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
    <div class="placeholder-icon ${persona.avatar ? 'hidden' : ''}">👤</div>
`;
      const nameHtml = `<span style="flex-grow: 1;">${escapeHtml(persona.name)}</span>`;
      const buttonsHtml = `
        <span class="edit-persona-icon" title="Edit Persona"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>
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
      document.getElementById('persona-chat-name').value = persona.chatName || persona.name || '';
      document.getElementById('persona-avatar').value = getImageUrl(persona.avatar || '');
      personaAvatarInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('persona-description').value = persona.description || '';

      const avatarUrl = getImageUrl(persona.avatar || '');
      personaEditorAvatarImg.src = avatarUrl;
      smartObjectFit(personaEditorAvatarImg);
      personaEditorAvatarPlaceholder.classList.toggle('hidden', !!avatarUrl);
      personaEditorAvatarImg.classList.toggle('hidden', !avatarUrl);
    } else {
      showErrorAlert('Error: Persona with ID ' + personaId + ' could not be found.');
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
        chatName: document.getElementById('persona-chat-name').value,
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

    if (event.target.closest('.delete-persona-btn')) {
        handleDeletePersona(personaId);
        return;
    }

    openPersonaEditor(personaId);
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
    <img src="${escapeHtml(imageUrl)}" class="${persona.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
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
    showErrorAlert("A JavaScript error has occurred. Please check the console (F12).");
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
  const cardType = cardTypeWorldRadio.checked ? 'world' : 'character';
  const chatName = cardType === 'world' ? '' : document.getElementById('chat-name').value;
  const avatarValue = document.getElementById('char-avatar').value;
  const backgroundValue = document.getElementById('char-background').value;
  // Read before closeEditor() drops the working copy further down.
  const gallery = editorGallery.slice();

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
  commitPendingTagInput();
  const tags = document.getElementById('char-tags').value;
  const reminder = document.getElementById('char-reminder').value;
  const narratorReminder = document.getElementById('char-narrator-reminder').value;
  const musicUrl = document.getElementById('char-music-url').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n');
  const characterIds = cardType === 'world' ? Array.from(worldCharSelectedIds) : [];
  const scenarioEntries = document.querySelectorAll('#scenario-editor-list .scenario-entry');
  const scenarios = [];
  scenarioEntries.forEach(entry => {
    const row = readScenarioRow(entry);
    // Keep the row if EITHER field was filled in - a scenario can legitimately
    // be memories with no greeting of its own.
    if (!row.greeting.trim() && !row.memories.trim()) return;
    scenarios.push({
      name: row.name || 'Unnamed Scenario',
      greeting: row.greeting,
      memories: row.memories
    });
  });

  const loreModeRadio = document.querySelector('input[name="lore-mode"]:checked');
  const loreMode = loreModeRadio ? loreModeRadio.value : 'flat';
  const loreEntries = [];
  document.querySelectorAll('#lore-editor-list .lore-entry').forEach(entry => {
    const keyInput = entry.querySelector('.lore-keyword-input');
    const textInput = entry.querySelector('textarea');
    if (textInput && textInput.value.trim() !== "") {
      loreEntries.push({
        keywords: (keyInput ? keyInput.value : '').trim(),
        text: textInput.value
      });
    }
  });
    closeEditor();

  if (charIdToEdit) {
    const character = characters[charIdToEdit];
    character.name = cardName;
    character.chatName = chatName;
    character.avatar = cardType === 'world' ? '' : finalAvatar;
    character.background = finalBackground;
    character.gallery = gallery;
    character.instructions = instructions;
    character.description = description;
    character.lore = lore;
    character.loreMode = loreMode;
    character.loreEntries = loreEntries;
    character.tags = tags;
    character.reminder = reminder;
    character.narratorReminder = narratorReminder;
    character.musicUrl = musicUrl;
    character.scenarios = scenarios;
    character.type = cardType;
    character.characterIds = characterIds;
    await saveSingleCharacterToDB(character);
  } else {
    const newCharacter = {
      id: 'char-' + Date.now(),
      name: cardName,
      chatName: chatName,
      avatar: cardType === 'world' ? '' : finalAvatar,
      background: finalBackground,
      gallery: gallery,
      instructions: instructions,
      description: description,
      lore: lore,
      loreMode: loreMode,
      loreEntries: loreEntries,
      tags: tags,
      reminder: reminder,
      narratorReminder: narratorReminder,
      musicUrl: musicUrl,
      scenarios: scenarios,
      type: cardType,
      characterIds: characterIds,
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



// Reads one scenario row back out of the DOM.
function readScenarioRow(entryDiv) {
    const name = (entryDiv.querySelector('.scenario-name-input')?.value || '').trim();
    const greeting = entryDiv.querySelector('.scenario-greeting-input')?.value || '';
    const memories = entryDiv.querySelector('.scenario-memories-input')?.value || '';
    return { name, greeting, memories };
}

function createScenarioInput(scenario) {
    const scenarioListDiv = document.getElementById('scenario-editor-list');
    const data = (scenario && typeof scenario === 'object') ? scenario : {};
    // `text` is the pre-split shape. Anything saved or imported before the
    // greeting/memories split kept everything in it, and it is the greeting.
    const greetingValue = typeof data.greeting === 'string'
        ? data.greeting
        : (typeof data.text === 'string' ? data.text : '');

    const entryDiv = document.createElement('div');
    entryDiv.className = 'scenario-entry';
    const fieldsWrapper = document.createElement('div');
    fieldsWrapper.className = 'scenario-fields';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'scenario-name-input';
    nameInput.placeholder = 'Scenario title';
    nameInput.value = data.name || '';

    // The field names live in the placeholders, like the title above them, so
    // nothing but the boxes themselves takes up room.
    const textarea = document.createElement('textarea');
    textarea.rows = 7;
    textarea.className = 'scenario-greeting-input';
    textarea.placeholder = 'Greeting: opening message of the chat.';
    textarea.value = greetingValue;
    textarea.addEventListener('dblclick', (e) => e.target.style.height = `${e.target.scrollHeight}px`);
    textarea.addEventListener('input', autoResizeTextarea);

    /* Sits directly under the greeting rather than behind a disclosure: the two
     * together are the scenario. The greeting opens the chat once and then
     * scrolls away; this becomes the chat's memories, sent with every request. */
    const memoriesInput = document.createElement('textarea');
    memoriesInput.rows = 5;
    memoriesInput.className = 'scenario-memories-input';
    memoriesInput.placeholder = 'Chat Memories: what to remember, including what is still to come.';
    memoriesInput.value = normalizeMemories(data.memories ?? data);
    memoriesInput.addEventListener('dblclick', (e) => e.target.style.height = `${e.target.scrollHeight}px`);
    memoriesInput.addEventListener('input', autoResizeTextarea);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-scenario-btn';
    deleteBtn.title = 'Delete Scenario';
    deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

    fieldsWrapper.appendChild(nameInput);
    fieldsWrapper.appendChild(textarea);
    fieldsWrapper.appendChild(memoriesInput);
    entryDiv.appendChild(fieldsWrapper);
    entryDiv.appendChild(deleteBtn);
    scenarioListDiv.appendChild(entryDiv);
}

document.getElementById('add-scenario-btn').addEventListener('click', () => {
    createScenarioInput({ name: '', greeting: '' });
});

document.getElementById('ai-scenario-btn').addEventListener('click', handleAIGenerateScenario);

document.getElementById('scenario-editor-list').addEventListener('click', async (event) => {
    if (event.target.classList.contains('delete-scenario-btn')) {
        if (await showCustomConfirm("Do you really want to delete this scenario?", true)) {
            event.target.parentElement.remove();
        }
    }
});

// --- Keyword-triggered lorebook entries ---
function createLoreEntryInput(entry = {}) {
    const listDiv = document.getElementById('lore-editor-list');
    const entryDiv = document.createElement('div');
    entryDiv.className = 'scenario-entry lore-entry';
    const fieldsWrapper = document.createElement('div');
    fieldsWrapper.style.flexGrow = '1';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'scenario-name-input lore-keyword-input';
    keyInput.placeholder = 'Trigger keywords (comma-separated, e.g. sword, blade, weapon)';
    keyInput.value = entry.keywords || '';

    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.placeholder = 'Lore text added to context when a keyword above appears in recent messages.';
    textarea.value = entry.text || '';
    textarea.addEventListener('dblclick', (e) => e.target.style.height = `${e.target.scrollHeight}px`);
    textarea.addEventListener('input', autoResizeTextarea);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-scenario-btn delete-lore-entry-btn';
    deleteBtn.title = 'Delete Lore Entry';
    deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

    fieldsWrapper.appendChild(keyInput);
    fieldsWrapper.appendChild(textarea);
    entryDiv.appendChild(fieldsWrapper);
    entryDiv.appendChild(deleteBtn);
    listDiv.appendChild(entryDiv);
}

function updateEditorForLoreMode(mode) {
    const flatC = document.getElementById('lore-flat-container');
    const kwC = document.getElementById('lore-keyword-container');
    if (!flatC || !kwC) return;
    if (mode === 'keyword') {
        flatC.classList.add('hidden');
        kwC.classList.remove('hidden');
    } else {
        flatC.classList.remove('hidden');
        kwC.classList.add('hidden');
    }
}

document.querySelectorAll('input[name="lore-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.checked) updateEditorForLoreMode(e.target.value);
    });
});

document.getElementById('add-lore-entry-btn').addEventListener('click', () => {
    createLoreEntryInput({});
});

document.getElementById('lore-editor-list').addEventListener('click', async (event) => {
    const delBtn = event.target.closest('.delete-lore-entry-btn');
    if (delBtn) {
        if (await showCustomConfirm("Do you really want to delete this lore entry?", true)) {
            delBtn.closest('.lore-entry').remove();
        }
    }
});

document.getElementById('lore-editor-list').addEventListener('input', updateEditorTokenCount);

// --- Character randomizer: start a fresh chat with a random character and a random mood ---
async function startRandomChat() {
    const pool = Object.values(characters).filter(c => c.type !== 'world' && !c.isArchived);
    if (pool.length === 0) {
        showCustomAlert('No characters available for a random chat. Create a character first!');
        return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    currentCharacterId = pick.id;
    const RANDOM_MOODS = ['Happy', 'Sad', 'Angry', 'Excited', 'Nervous', 'Flirty', 'Tired', 'Curious', 'Scared', 'Bored'];
    const randomMood = RANDOM_MOODS[Math.floor(Math.random() * RANDOM_MOODS.length)];
    await createNewChat(null, null, randomMood);
}

document.getElementById('random-chat-btn')?.addEventListener('click', startRandomChat);



// The context length is an Ollama setting, and Ollama runs on a machine the
// user controls, so the field is only worth showing once the model points
// somewhere other than a normal online provider: localhost, a LAN or VPN
// address, or a name that only resolves on the local network. OpenRouter and
// the other hosted providers ignore num_ctx, so there the field stays hidden.
function isLocalProviderUrl(url) {
    const raw = (url || '').trim();
    if (!raw) return false;
    let hostname;
    try {
        // Users often type "localhost:11434/..." without a scheme.
        hostname = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname.toLowerCase();
    } catch (_) {
        return false;
    }
    if (!hostname) return false;

    // The URL parser hands IPv6 back wrapped in brackets.
    if (hostname.startsWith('[')) {
        const v6 = hostname.slice(1, -1);
        return v6 === '::1'             // loopback
            || /^f[cd]/.test(v6)        // fc00::/7, the private range
            || /^fe[89ab]/.test(v6);    // fe80::/10, link-local
    }

    const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const a = Number(v4[1]);
        const b = Number(v4[2]);
        return a === 0                          // 0.0.0.0, "this machine"
            || a === 10                         // private
            || a === 127                        // loopback
            || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT, what Tailscale hands out
            || (a === 169 && b === 254)         // link-local
            || (a === 172 && b >= 16 && b <= 31) // private
            || (a === 192 && b === 168);        // private
    }

    // A bare name with no dot only resolves on the local network, and these
    // suffixes are reserved for it.
    return !hostname.includes('.')
        || /\.(localhost|local|lan|home|internal|intranet|arpa)$/.test(hostname);
}

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
    const numCtx = model.numCtx != null ? model.numCtx : '';

    entryDiv.innerHTML = `
    <div class="model-drag-handle" title="Drag to reorder">
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="2" y1="2" x2="12" y2="2"/>
            <line x1="2" y1="6" x2="12" y2="6"/>
            <line x1="2" y1="10" x2="12" y2="10"/>
        </svg>
    </div>
    <div class="model-content-wrapper">
        <div class="model-entry-inputs">
            <input type="text" class="model-name-input" placeholder="Display Name (e.g., My favorite Model)">
            <input type="text" class="model-id-input" placeholder="Technical Model ID (e.g., provider/model-name)">
            <input type="url" class="model-target-api-url-input" placeholder="Other provider URL (https://.../v1/chat/completions)">
            <input type="password" class="model-api-key-input" placeholder="Other provider API Key (sk-1a2b3c...xyz)">
            <input type="number" class="model-num-ctx-input" placeholder="Context length (only relevant for Ollama - e.g. 8192)" min="512" step="512">
        </div>
        <details class="global-prompts-container">
            <summary class="global-prompts-summary">Global Prompts</summary>
            <div class="global-prompts-content">
                <label>AI Instructions:</label>
                <textarea class="model-instructions-input" rows="2" placeholder="General AI Instructions for this model... (e.g., 'Be creative and drive the plot forward.')"></textarea>
                <label>Character Reminder:</label>
                <textarea class="model-reminder-input" rows="2" placeholder="Character Reminder for this model... (e.g., 'Reply only as {{char}} now.')"></textarea>
                <label>Narrator Reminder:</label>
                <textarea class="model-narrator-reminder-input" rows="2" placeholder="Narrator Reminder for this model... (e.g., 'Reply only as an omniscient narrator now.')"></textarea>
            </div>
        </details>
    </div>
    <button type="button" class="delete-model-btn" title="Delete Model"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
    `;

    // Assigned as properties rather than written into the markup above, so a
    // quote or a tag in a name or prompt stays text and survives a save.
    entryDiv.querySelector('.model-name-input').value = name;
    entryDiv.querySelector('.model-id-input').value = id;
    entryDiv.querySelector('.model-target-api-url-input').value = targetApiUrl;
    entryDiv.querySelector('.model-api-key-input').value = apiKey;
    entryDiv.querySelector('.model-num-ctx-input').value = numCtx;
    entryDiv.querySelector('.model-instructions-input').value = instructions;
    entryDiv.querySelector('.model-reminder-input').value = reminder;
    entryDiv.querySelector('.model-narrator-reminder-input').value = narratorReminder;

    const targetApiUrlInput = entryDiv.querySelector('.model-target-api-url-input');
    const numCtxInput = entryDiv.querySelector('.model-num-ctx-input');
    const syncNumCtxVisibility = () => {
        numCtxInput.classList.toggle('hidden', !isLocalProviderUrl(targetApiUrlInput.value));
    };
    // Hidden only, never removed: an entry that already has a context length
    // keeps it if the URL is edited away and back again.
    targetApiUrlInput.addEventListener('input', syncNumCtxVisibility);
    syncNumCtxVisibility();

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

    enableRowDragReorder(entryDiv, {
        listEl: modelListContainer,
        handleEl: entryDiv.querySelector('.model-drag-handle'),
        rowSelector: '.model-entry',
        scrollEl: appSettingsModalContent
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
            // Text the user wrote into an error bubble is theirs, and part of
            // the story from now on.
            delete activeVariant.notice;
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

    if (lastCharId && lastChatId && characters[lastCharId] && characters[lastCharId].chats?.[lastChatId]) {
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
    



// =============================================================
// IMAGE ADJUST — crop frame with free zoom & pan
// -------------------------------------------------------------
// Opens right after a local image file is picked. The picture sits behind a
// fixed frame; everything spilling outside it stays visible but dimmed. The
// user pans (drag / one finger) and zooms (wheel / pinch / the zoom bar on the
// right), "Apply" cuts out whatever overlaps the frame.
//
// The frame shape depends on where the picture is headed:
//
//  * avatars — a square, and zooming out past "fills the square" is allowed on
//    purpose. The cut-out is then the intersection of picture and frame, i.e.
//    narrower or shorter than a square. Those non-square avatars keep working
//    because every avatar surface renders them contained on a blurred backdrop
//    (.effect-container).
//
//  * backgrounds — the current screen rectangle (landscape on desktop, tall on
//    a phone), because a background is painted onto a full-viewport element
//    with `background-size: cover`. That also means zooming out below "fills
//    the frame" is pointless there: the browser would crop the empty margin
//    straight back off, so the floor stays at cover and the preview is exactly
//    what the screen will show.
// =============================================================
const openImageAdjuster = (() => {
    const MAX_ZOOM = 10;             // hard ceiling relative to "fills the frame"
    const NUDGE = 0.08;              // +/- button step, in zoom-bar ratio
    const STAGE_MARGIN = 0.17;       // dimmed overflow margin around the frame

    const modal = document.getElementById('image-crop-modal');
    if (!modal) return () => Promise.resolve(null);

    const contentEl = modal.querySelector('.image-crop-content');
    const stage = document.getElementById('image-crop-stage');
    const frameEl = document.getElementById('image-crop-frame');
    const imgEl = document.getElementById('image-crop-img');
    const titleEl = document.getElementById('image-crop-title');
    const hintEl = document.getElementById('image-crop-hint');
    const trackEl = document.getElementById('image-crop-zoom-track');
    const fillEl = document.getElementById('image-crop-zoom-fill');
    const thumbEl = document.getElementById('image-crop-zoom-thumb');
    const zoomInBtn = document.getElementById('image-crop-zoom-in');
    const zoomOutBtn = document.getElementById('image-crop-zoom-out');
    const applyBtn = document.getElementById('image-crop-apply-btn');
    const cancelBtn = document.getElementById('image-crop-cancel-btn');
    const resetBtn = document.getElementById('image-crop-reset-btn');
    const flipBtn = document.getElementById('image-crop-flip-btn');

    // Live session state. `null` whenever the modal is closed.
    // z = zoom where 1 exactly fills the frame, ox/oy = picture centre offset
    // from the frame centre in CSS px, flip = -1 once mirrored horizontally.
    let st = null;
    let sourceImg = null;
    let settle = null;
    const pointers = new Map();
    let pinchStart = null;
    let dragLast = null;
    let sliderPointerId = null;

    const isTouchOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    // Space budget for the stage. The four --crop-* custom properties live on
    // .image-crop-content so the breakpoints (portrait phone, landscape phone,
    // desktop) can retune the layout without touching this math.
    function budget(name, fallback) {
        const raw = parseFloat(getComputedStyle(contentEl).getPropertyValue(name));
        return Number.isFinite(raw) ? raw : fallback;
    }

    // Largest frame of the requested shape that still leaves room for the
    // dimmed margin, the zoom bar and the buttons. Driven from the viewport so
    // it adapts to a phone in portrait or landscape just as well as to a
    // desktop window.
    function fitFrame(aspect) {
        const grow = 1 + 2 * STAGE_MARGIN;
        const boxW = Math.min(window.innerWidth - budget('--crop-gutter', 96),
                              budget('--crop-stage-max-w', 520)) / grow;
        const boxH = Math.min(window.innerHeight - budget('--crop-chrome', 250),
                              budget('--crop-stage-max-h', 470)) / grow;
        const cap = budget('--crop-cap', 360) / Math.max(aspect, 1);   // longest frame side
        const h = Math.max(60, Math.min(boxW / aspect, boxH, cap));
        return { w: h * aspect, h };
    }

    function applyFrameSize(frameW, frameH) {
        const margin = Math.min(frameW, frameH) * STAGE_MARGIN;

        // Sideways phones have width to spare while the frame is capped by the
        // screen height, so --crop-margin-x widens the dimmed band instead of
        // leaving the space empty — more of the picture stays in view and the
        // zoom bar moves out to the right.
        const roomX = Math.min(window.innerWidth - budget('--crop-gutter', 96),
                               budget('--crop-stage-max-w', 520)) - frameW;
        const marginX = Math.round(Math.max(margin, Math.min(margin * budget('--crop-margin-x', 1), roomX / 2)));

        frameEl.style.width = frameW + 'px';
        frameEl.style.height = frameH + 'px';
        stage.style.width = (frameW + 2 * marginX) + 'px';
        stage.style.height = (frameH + 2 * Math.round(margin)) + 'px';
    }

    // Point relative to the centre of the crop frame.
    function framePoint(clientX, clientY) {
        const r = frameEl.getBoundingClientRect();
        return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
    }

    function buildState(nw, nh, frameW, frameH, options) {
        // At zoom 1 the picture exactly covers the frame, so its layout size is
        // the natural size scaled by "cover".
        const coverScale = Math.max(frameW / nw, frameH / nh);
        const layoutW = nw * coverScale;
        const layoutH = nh * coverScale;

        // Floor: the whole picture fits inside the frame. Zooming out further
        // would not reveal anything new, the cut-out stays the whole picture.
        // Callers that need a frame-filling result keep the floor at cover.
        const zMin = options.allowZoomOut === false
            ? 1
            : Math.min(frameW / layoutW, frameH / layoutH);

        // Ceiling: at zoom 1 the cut-out measures frame / coverScale source
        // pixels, shrinking as the zoom grows. Cap the zoom where its short
        // side would drop below minCropPx. The floor is deliberately low —
        // framing beats sharpness, so a soft close-up is the user's call to
        // make; it only stops the crop from collapsing into a few pixels.
        const cropShort = Math.min(frameW, frameH) / coverScale;
        const minCropPx = options.minCropPx || 96;
        const zMax = Math.max(1, Math.min(MAX_ZOOM, cropShort / Math.min(minCropPx, cropShort)));

        return { nw, nh, layoutW, layoutH, frameW, frameH, zMin, zMax, z: 1, ox: 0, oy: 0, flip: 1 };
    }

    // Keeps the picture glued to the frame: while it is larger than the frame
    // no gap can open up, while it is smaller it cannot be pushed outside.
    function clampState() {
        st.z = Math.min(st.zMax, Math.max(st.zMin, st.z));
        const slackX = Math.abs(st.layoutW * st.z - st.frameW) / 2;
        const slackY = Math.abs(st.layoutH * st.z - st.frameH) / 2;
        st.ox = Math.min(slackX, Math.max(-slackX, st.ox));
        st.oy = Math.min(slackY, Math.max(-slackY, st.oy));
    }

    function zoomToRatio(z) {
        if (st.zMax - st.zMin < 1e-6) return 0;
        return Math.log(z / st.zMin) / Math.log(st.zMax / st.zMin);
    }

    function ratioToZoom(t) {
        if (st.zMax - st.zMin < 1e-6) return st.zMin;
        return st.zMin * Math.pow(st.zMax / st.zMin, Math.min(1, Math.max(0, t)));
    }

    function renderZoomBar() {
        const radius = (thumbEl.offsetHeight || 17) / 2;
        const usable = Math.max(1, trackEl.clientHeight - 2 * radius);
        const ratio = zoomToRatio(st.z);
        const pos = radius + ratio * usable;

        thumbEl.style.bottom = pos + 'px';
        fillEl.style.height = pos + 'px';

        const locked = st.zMax - st.zMin < 1e-6;
        trackEl.classList.toggle('is-disabled', locked);
        trackEl.setAttribute('aria-valuenow', Math.round(ratio * 100));
        trackEl.setAttribute('aria-valuetext', st.z.toFixed(2) + '×');
        zoomInBtn.disabled = locked || st.z >= st.zMax - 1e-4;
        zoomOutBtn.disabled = locked || st.z <= st.zMin + 1e-4;
    }

    function render() {
        clampState();
        // A negative x scale mirrors the picture about its own centre line.
        imgEl.style.transform =
            `translate(-50%, -50%) translate(${st.ox}px, ${st.oy}px) scale(${st.z * st.flip}, ${st.z})`;
        flipBtn.classList.toggle('is-active', st.flip < 0);
        flipBtn.setAttribute('aria-pressed', st.flip < 0 ? 'true' : 'false');
        renderZoomBar();
    }

    // Mirroring also mirrors the offset, so the framed cut-out keeps showing
    // the same part of the picture — just the other way round.
    function toggleFlip() {
        if (!st) return;
        st.flip = -st.flip;
        st.ox = -st.ox;
        render();
    }

    // Zooms around `anchor` (frame centre by default) so the picture point under
    // the cursor / pinch centre stays put.
    function setZoom(z, anchor) {
        const next = Math.min(st.zMax, Math.max(st.zMin, z));
        const a = anchor || { x: 0, y: 0 };
        const k = next / st.z;
        st.ox = a.x + (st.ox - a.x) * k;
        st.oy = a.y + (st.oy - a.y) * k;
        st.z = next;
        render();
    }

    function nudgeZoom(delta) {
        if (!st) return;
        setZoom(ratioToZoom(zoomToRatio(st.z) + delta));
    }

    // --- dragging & pinching -------------------------------------------------

    function pointerPair() {
        const list = [...pointers.values()];
        return [list[0], list[1]];
    }

    function beginPinch() {
        const [a, b] = pointerPair();
        if (!a || !b) return;
        pinchStart = {
            dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            mid: framePoint((a.x + b.x) / 2, (a.y + b.y) / 2),
            z: st.z,
            ox: st.ox,
            oy: st.oy
        };
        dragLast = null;
    }

    function updatePinch() {
        if (!pinchStart) { beginPinch(); return; }
        const [a, b] = pointerPair();
        if (!a || !b) return;

        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = framePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const target = Math.min(st.zMax, Math.max(st.zMin, pinchStart.z * (dist / pinchStart.dist)));
        const k = target / pinchStart.z;

        // Scale around the original pinch centre, then follow that centre as the
        // fingers travel — pinch and drag in one gesture.
        st.ox = pinchStart.mid.x + (pinchStart.ox - pinchStart.mid.x) * k + (mid.x - pinchStart.mid.x);
        st.oy = pinchStart.mid.y + (pinchStart.oy - pinchStart.mid.y) * k + (mid.y - pinchStart.mid.y);
        st.z = target;
        render();
    }

    stage.addEventListener('pointerdown', (e) => {
        if (!st) return;
        e.preventDefault();
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
            beginPinch();
        } else if (pointers.size === 1) {
            dragLast = { x: e.clientX, y: e.clientY };
            stage.classList.add('is-dragging');
        }
    });

    stage.addEventListener('pointermove', (e) => {
        if (!st || !pointers.has(e.pointerId)) return;
        e.preventDefault();
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size >= 2) {
            updatePinch();
        } else if (dragLast) {
            st.ox += e.clientX - dragLast.x;
            st.oy += e.clientY - dragLast.y;
            dragLast = { x: e.clientX, y: e.clientY };
            render();
        }
    });

    function releasePointer(e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        try { stage.releasePointerCapture(e.pointerId); } catch (_) {}

        if (pointers.size < 2) pinchStart = null;
        if (pointers.size === 1) {
            // Second finger lifted — keep dragging with the one still down.
            const [p] = pointers.values();
            dragLast = { x: p.x, y: p.y };
        } else {
            dragLast = null;
            stage.classList.remove('is-dragging');
        }
    }

    stage.addEventListener('pointerup', releasePointer);
    stage.addEventListener('pointercancel', releasePointer);

    stage.addEventListener('wheel', (e) => {
        if (!st) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 0.05 : (e.deltaMode === 2 ? 0.5 : 0.0022);
        setZoom(st.z * Math.exp(-e.deltaY * unit), framePoint(e.clientX, e.clientY));
    }, { passive: false });

    stage.addEventListener('dblclick', () => {
        if (!st) return;
        // Toggle between "whole picture visible" and "fills the square".
        setZoom(st.z > st.zMin + 1e-4 ? st.zMin : 1);
    });

    // --- zoom bar ------------------------------------------------------------

    function ratioFromClientY(clientY) {
        const r = trackEl.getBoundingClientRect();
        const radius = (thumbEl.offsetHeight || 17) / 2;
        const usable = Math.max(1, r.height - 2 * radius);
        return Math.min(1, Math.max(0, (r.bottom - radius - clientY) / usable));
    }

    trackEl.addEventListener('pointerdown', (e) => {
        if (!st || trackEl.classList.contains('is-disabled')) return;
        e.preventDefault();
        sliderPointerId = e.pointerId;
        try { trackEl.setPointerCapture(e.pointerId); } catch (_) {}
        setZoom(ratioToZoom(ratioFromClientY(e.clientY)));
    });

    trackEl.addEventListener('pointermove', (e) => {
        if (!st || sliderPointerId !== e.pointerId) return;
        e.preventDefault();
        setZoom(ratioToZoom(ratioFromClientY(e.clientY)));
    });

    function releaseSlider(e) {
        if (sliderPointerId !== e.pointerId) return;
        try { trackEl.releasePointerCapture(e.pointerId); } catch (_) {}
        sliderPointerId = null;
    }

    trackEl.addEventListener('pointerup', releaseSlider);
    trackEl.addEventListener('pointercancel', releaseSlider);

    trackEl.addEventListener('keydown', (e) => {
        if (!st) return;
        const steps = {
            ArrowUp: NUDGE, ArrowRight: NUDGE,
            ArrowDown: -NUDGE, ArrowLeft: -NUDGE
        };
        if (e.key in steps) nudgeZoom(steps[e.key]);
        else if (e.key === 'Home') setZoom(st.zMin);
        else if (e.key === 'End') setZoom(st.zMax);
        else return;

        // Arrow keys elsewhere in the app flip message variants.
        e.preventDefault();
        e.stopPropagation();
    });

    zoomInBtn.addEventListener('click', () => nudgeZoom(NUDGE));
    zoomOutBtn.addEventListener('click', () => nudgeZoom(-NUDGE));

    // --- cropping ------------------------------------------------------------

    // Intersection of picture and frame, expressed in source pixels.
    function computeCrop() {
        const perSourcePx = (st.layoutW * st.z) / st.nw;  // display px per source px
        const dispW = st.layoutW * st.z;
        const dispH = st.layoutH * st.z;
        const halfW = st.frameW / 2;
        const halfH = st.frameH / 2;

        const left = Math.max(-halfW, st.ox - dispW / 2);
        const right = Math.min(halfW, st.ox + dispW / 2);
        const top = Math.max(-halfH, st.oy - dispH / 2);
        const bottom = Math.min(halfH, st.oy + dispH / 2);

        let sx = (left - (st.ox - dispW / 2)) / perSourcePx;
        let sy = (top - (st.oy - dispH / 2)) / perSourcePx;
        let sw = (right - left) / perSourcePx;
        let sh = (bottom - top) / perSourcePx;

        // The maths above works in "what the user sees" space; on a mirrored
        // picture that is the source read right to left, so flip the x origin
        // back into source coordinates.
        if (st.flip < 0) sx = st.nw - sx - sw;

        sx = Math.max(0, Math.min(st.nw - 1, sx));
        sy = Math.max(0, Math.min(st.nh - 1, sy));
        sw = Math.max(1, Math.min(sw, st.nw - sx));
        sh = Math.max(1, Math.min(sh, st.nh - sy));

        return { sx, sy, sw, sh };
    }

    async function applyCrop() {
        if (!st || !sourceImg) return;
        applyBtn.disabled = true;

        try {
            const { sx, sy, sw, sh } = computeCrop();
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(sw));
            canvas.height = Math.max(1, Math.round(sh));

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            if (st.flip < 0) {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

            const result = await canvasToWebp(canvas, 0.80);
            finish(result);
        } catch (error) {
            console.error('Error cropping image:', error);
            finish(null);
            showErrorAlert('There was an error processing the image file.');
        } finally {
            applyBtn.disabled = false;
        }
    }

    // --- open / close --------------------------------------------------------

    function onKeyDown(e) {
        if (!st) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            applyCrop();
        }
    }

    // The frame is sized from the viewport, so a window change resizes it.
    // Rescale the state along with it to keep the current framing. The frame
    // shape stays as it was when the session opened.
    function onResize() {
        if (!st) return;
        const next = fitFrame(st.frameW / st.frameH);
        if (Math.abs(next.w - st.frameW) < 0.5) return;

        const ratio = next.w / st.frameW;
        st.layoutW *= ratio;
        st.layoutH *= ratio;
        st.ox *= ratio;
        st.oy *= ratio;
        st.frameW = next.w;
        st.frameH = next.h;
        applyFrameSize(next.w, next.h);
        imgEl.style.width = st.layoutW + 'px';
        imgEl.style.height = st.layoutH + 'px';
        render();
    }

    function close() {
        modal.classList.add('hidden');
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onResize);
        stage.classList.remove('is-dragging');
        pointers.clear();
        pinchStart = null;
        dragLast = null;
        sliderPointerId = null;
        st = null;
        sourceImg = null;
        imgEl.removeAttribute('src');
    }

    function finish(result) {
        const done = settle;
        settle = null;
        close();
        if (done) done(result);
    }

    applyBtn.addEventListener('click', applyCrop);
    cancelBtn.addEventListener('click', () => finish(null));
    flipBtn.addEventListener('click', toggleFlip);
    resetBtn.addEventListener('click', () => {
        if (!st) return;
        st.z = 1;
        st.ox = 0;
        st.oy = 0;
        st.flip = 1;
        render();
    });

    /**
     * Shows the adjuster for `src`.
     *
     * options.aspect       frame width / height, defaults to 1 (square)
     * options.allowZoomOut false keeps the floor at "fills the frame"
     * options.minCropPx    smallest cut-out short side, in source pixels
     * options.title        modal heading
     * options.note         extra line under the heading
     *
     * Resolves with { blob, dataURL } on apply, or null when cancelled.
     * Rejects when the image can't be decoded.
     */
    return function openImageAdjuster(src, options = {}) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                if (!img.naturalWidth || !img.naturalHeight) {
                    reject(new Error('Image has no dimensions'));
                    return;
                }

                sourceImg = img;
                settle = resolve;
                titleEl.textContent = options.title || 'Adjust Image';
                hintEl.textContent = (isTouchOnly
                    ? 'Drag to reposition · pinch to zoom'
                    : 'Drag to reposition · scroll to zoom') + (options.note ? ' · ' + options.note : '');

                const aspect = options.aspect > 0 ? options.aspect : 1;
                const frame = fitFrame(aspect);
                applyFrameSize(frame.w, frame.h);

                imgEl.src = src;
                modal.classList.remove('hidden');

                st = buildState(img.naturalWidth, img.naturalHeight, frame.w, frame.h, options);
                imgEl.style.width = st.layoutW + 'px';
                imgEl.style.height = st.layoutH + 'px';
                render();

                document.addEventListener('keydown', onKeyDown, true);
                window.addEventListener('resize', onResize);
            };

            img.onerror = () => reject(new Error('Could not load the selected image'));
            img.src = src;
        });
    };
})();



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

// Let the user frame the picture before it is stored. Avatars crop to a
// square, backgrounds to the shape of the screen they will be painted on.
// Shared with the gallery, so a picture handed over from there is framed
// exactly like a freshly uploaded one.
function imageAdjustOptionsFor(targetId) {
    return {
        'char-avatar': { title: 'Adjust Character Image' },
        'persona-avatar': { title: 'Adjust Persona Image' },
        'char-background': {
            title: 'Adjust Background Image',
            aspect: (window.innerWidth || 1) / (window.innerHeight || 1),
            allowZoomOut: false,      // backgrounds are painted with `cover`
            minCropPx: 120,
            note: 'the frame matches your screen'
        }
    }[targetId];
}

// Parks a freshly framed picture on the editor: the webp copy waits in
// tempUploadedImages until save, the matching URL field shows a preview.
function applyAdjustedCardImage(targetId, adjusted) {
    const { dataURL, blob } = adjusted;
    const objectURL = URL.createObjectURL(blob);

    if (targetId === 'char-avatar') {
        tempUploadedImages.avatar = dataURL;
    } else if (targetId === 'char-background') {
        tempUploadedImages.background = dataURL;
    } else if (targetId === 'persona-avatar') {
        tempUploadedImages.personaAvatar = dataURL;
    }

    const targetInput = document.getElementById(targetId);
    if (targetInput) {
        targetInput.value = objectURL;
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

imageUploader.addEventListener('change', async (event) => {
    if (!currentUploadTargetId) return;
    const targetId = currentUploadTargetId;
    const file = event.target.files[0];

    imageUploader.value = '';
    currentUploadTargetId = null;
    if (!file) return;

    try {
        const adjustOptions = imageAdjustOptionsFor(targetId);

        const originalDataURL = await fileToDataURL(file);
        const adjusted = adjustOptions
            ? await openImageAdjuster(originalDataURL, adjustOptions)
            : await imageFileToWebp(file, 0.80);
        if (!adjusted) return;   // cancelled — leave the current image alone

        applyAdjustedCardImage(targetId, adjusted);
    } catch (error) {
        console.error("Error converting file to Data URL:", error);
        showErrorAlert("There was an error processing the image file.");
    }
});



// =============================================================
// CHARACTER GALLERY — spare pictures kept on the card
// -------------------------------------------------------------
// The strip between the image URL fields and the description holds every
// picture a card owns. Uploads land there downscaled and webp-encoded,
// the same treatment the avatar and background copies get, so a card with
// a dozen pictures still costs a few hundred KB in IndexedDB.
//
// Clicking a thumbnail opens a small chooser: hand the picture to the
// avatar, hand it to the background, or drop it. Either hand-off runs it
// through the usual crop frame first — the gallery keeps the whole
// picture, each surface takes the cut-out it needs.
//
// Edits go into `editorGallery`, a working copy that only reaches the
// character on save, so cancelling the editor discards them along with
// every other unsaved change.
// =============================================================
const GALLERY_MAX_SIDE = 1600;   // longest edge of a stored gallery picture

// Tolerates both shapes a card may carry: bare data URL strings and the
// { src } records an older/other build might have written.
function normalizeGallery(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(entry => (typeof entry === 'string' ? entry : entry && entry.src)).filter(Boolean);
}

// Bumped every time the strip changes hands. An upload batch that is still
// encoding when the editor closes or moves to another card carries the old
// number and drops its remaining pictures instead of filing them elsewhere.
let editorGallerySession = 0;

function resetEditorGallery(images) {
    editorGallery = images;
    editorGallerySession++;
    renderEditorGallery();
}

function renderEditorGallery() {
    const strip = document.getElementById('editor-gallery-strip');
    const addBtn = document.getElementById('editor-gallery-add-btn');
    if (!strip || !addBtn) return;

    strip.querySelectorAll('.editor-gallery-thumb').forEach(el => el.remove());

    editorGallery.forEach((src, index) => {
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'editor-gallery-thumb effect-container';
        thumb.title = 'Use this image';
        thumb.setAttribute('aria-label', `Gallery image ${index + 1}`);
        thumb.style.backgroundImage = cssUrl(src);

        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        thumb.appendChild(img);

        thumb.addEventListener('click', () => openGalleryActionModal(index));
        // Appended, so the "+" tile stays first and in view no matter how far
        // the strip has grown.
        strip.appendChild(thumb);
    });

    // Nothing to tap yet — the hint would only be in the way.
    const hint = document.getElementById('editor-gallery-hint');
    if (hint) hint.classList.toggle('hidden', editorGallery.length === 0);
}

const galleryUploader = document.getElementById('gallery-uploader');
const galleryAddBtn = document.getElementById('editor-gallery-add-btn');

if (galleryAddBtn && galleryUploader) {
    galleryAddBtn.addEventListener('click', () => galleryUploader.click());

    galleryUploader.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        galleryUploader.value = '';
        if (files.length === 0) return;

        // One at a time: a batch of full-size photos decoded in parallel is
        // enough to stall a phone. Each one shows up as soon as it is ready.
        const session = editorGallerySession;
        galleryAddBtn.disabled = true;
        let failed = 0;
        try {
            for (const file of files) {
                try {
                    const { dataURL } = await imageFileToWebp(file, 0.80, GALLERY_MAX_SIDE);
                    if (session !== editorGallerySession) return;   // the editor moved on
                    editorGallery.push(dataURL);
                    renderEditorGallery();
                } catch (error) {
                    console.error('Error adding an image to the gallery:', error);
                    failed++;
                }
            }
        } finally {
            galleryAddBtn.disabled = false;
        }

        if (failed > 0) {
            showErrorAlert(failed === 1
                ? 'One image could not be processed and was skipped.'
                : `${failed} images could not be processed and were skipped.`);
        }
    });
}

const galleryActionModal = document.getElementById('gallery-action-modal');
const galleryActionImg = document.getElementById('gallery-action-img');
const galleryActionAvatarBtn = document.getElementById('gallery-action-avatar-btn');
const galleryActionBgBtn = document.getElementById('gallery-action-bg-btn');
const galleryActionDownloadBtn = document.getElementById('gallery-action-download-btn');
const galleryActionDeleteBtn = document.getElementById('gallery-action-delete-btn');
const galleryActionCancelBtn = document.getElementById('gallery-action-cancel-btn');
let galleryActionIndex = -1;

function onGalleryActionKeyDown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeGalleryActionModal();
    }
}

function closeGalleryActionModal() {
    galleryActionIndex = -1;
    document.removeEventListener('keydown', onGalleryActionKeyDown, true);
    if (!galleryActionModal) return;
    galleryActionModal.classList.add('hidden');
    galleryActionImg.removeAttribute('src');
    galleryActionImg.parentElement.style.backgroundImage = 'none';
}

function openGalleryActionModal(index) {
    const src = editorGallery[index];
    if (!galleryActionModal || !src) return;

    galleryActionIndex = index;
    galleryActionImg.src = src;
    galleryActionImg.parentElement.style.backgroundImage = cssUrl(src);
    // A world card has no avatar of its own — its tile shows the background.
    galleryActionAvatarBtn.classList.toggle('hidden', cardTypeWorldRadio.checked);
    galleryActionModal.classList.remove('hidden');
    document.addEventListener('keydown', onGalleryActionKeyDown, true);
}

async function assignGalleryImageTo(targetId) {
    const src = editorGallery[galleryActionIndex];
    if (!src) return;
    closeGalleryActionModal();

    try {
        const adjusted = await openImageAdjuster(src, imageAdjustOptionsFor(targetId));
        if (!adjusted) return;   // cancelled — leave the current image alone
        applyAdjustedCardImage(targetId, adjusted);
    } catch (error) {
        console.error('Error using the gallery image:', error);
        showErrorAlert('There was an error processing the image file.');
    }
}

// Names the saved file after the card it came from, so a folder of these
// stays sortable. Anything a file system would refuse — and the trailing
// dots and spaces Windows silently eats — comes out first.
function galleryDownloadName(index, mimeType) {
    const subtype = String(mimeType || '').split('/')[1] || '';
    const format = subtype.split(';')[0].toLowerCase();
    const extension = format === 'jpeg' ? 'jpg'
        : format === 'svg+xml' ? 'svg'
        : /^[a-z0-9]+$/.test(format) ? format
        : 'webp';   // the format the gallery stores

    const nameField = document.getElementById('card-name');
    const base = String((nameField && nameField.value) || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 60)
        .replace(/^[._]+|[._]+$/g, '');

    return `${base || 'gallery'}_image_${index + 1}.${extension}`;
}

// Hands the picture back to the device. Gallery entries are data URLs, so
// the bytes are already here and fetch() only has to decode them. A card
// imported with a remote image is fetched for real, and a host that blocks
// the cross-origin read leaves a new tab as the way to save it by hand.
async function downloadGalleryImage() {
    const index = galleryActionIndex;
    const src = editorGallery[index];
    if (!src) return;
    closeGalleryActionModal();

    let blob;
    try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        blob = await response.blob();
    } catch (error) {
        console.error('Error reading the gallery image for download:', error);
        if (/^https?:/i.test(src)) {
            window.open(src, '_blank', 'noopener');
        } else {
            showErrorAlert('There was an error preparing the image for download.');
        }
        return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = galleryDownloadName(index, blob.type);
    link.click();
    // Revoked late: some browsers are still reading the blob after the click
    // returns, and pulling the URL out from under the save cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

if (galleryActionModal) {
    galleryActionAvatarBtn.addEventListener('click', () => assignGalleryImageTo('char-avatar'));
    galleryActionBgBtn.addEventListener('click', () => assignGalleryImageTo('char-background'));
    galleryActionDownloadBtn.addEventListener('click', downloadGalleryImage);

    galleryActionDeleteBtn.addEventListener('click', async () => {
        const index = galleryActionIndex;
        closeGalleryActionModal();
        if (!editorGallery[index]) return;
        if (!await showCustomConfirm('Remove this image from the gallery?', true)) return;
        editorGallery.splice(index, 1);
        renderEditorGallery();
    });

    galleryActionCancelBtn.addEventListener('click', closeGalleryActionModal);
    galleryActionModal.addEventListener('click', (e) => {
        if (e.target === galleryActionModal) closeGalleryActionModal();
    });
}



const editorFieldsToMonitor = [
  'card-name', 'char-description', 'char-lore', 'char-instructions',
  'char-reminder', 'char-narrator-reminder'
];
document.getElementById('char-music-url')?.addEventListener('input', autoResizeTextarea);
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

const personaEditorFieldsToMonitor = ['persona-name', 'persona-chat-name', 'persona-description'];
personaEditorFieldsToMonitor.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('input', updatePersonaEditorTokenCount);
        if (element.tagName === 'TEXTAREA') {
            element.addEventListener('input', autoResizeTextarea);
        }
    }
});

// Registered once. It used to sit inside the loop above, so the preview ran
// three times on every keystroke.
personaAvatarInput.addEventListener('input', () => {
    const url = personaAvatarInput.value;
    const container = document.getElementById('persona-editor-avatar-container'); 

    if (url) {
        personaEditorAvatarImg.src = url;
        smartObjectFit(personaEditorAvatarImg);
        personaEditorAvatarImg.classList.remove('hidden');
        personaEditorAvatarPlaceholder.classList.add('hidden');
        container.classList.add('effect-container');
        container.style.backgroundImage = cssUrl(url);
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

    // Audio may only start once the user has interacted with the page. The
    // first click or key press creates the audio context and loads the sounds;
    // later ones wake it if the browser has suspended it since.
    const unlockAudio = () => {
        const firstTime = !audioCtx;
        if (ensureAudioContext() && firstTime) preloadSounds();
    };
    document.addEventListener('click', unlockAudio, true);
    document.addEventListener('keydown', unlockAudio, true);
    // A slider fires 'input' on every step of a drag. The setting is applied on
    // each one, but written to the database once the value settles - or at
    // once when the control reports its final value with 'change'.
    const pendingSettingSaves = {};
    function addSettingListener(element, key, eventType = 'input') {
    const isCheckbox = element.type === 'checkbox';
    const readValue = () => (isCheckbox ? element.checked.toString() : element.value);
    const writeNow = () => {
        clearTimeout(pendingSettingSaves[key]);
        delete pendingSettingSaves[key];
        saveSettingToDB(key, readValue()).catch(err => console.error(`Could not save setting ${key}:`, err));
    };
    element.addEventListener(eventType, () => {
        applySetting(key, readValue());
        if (eventType !== 'input') { writeNow(); return; }
        clearTimeout(pendingSettingSaves[key]);
        pendingSettingSaves[key] = setTimeout(writeNow, 300);
    });
    if (eventType === 'input') {
        element.addEventListener('change', () => {
            if (pendingSettingSaves[key]) writeNow();
        });
    }
}

    // --- NEW FEATURES ---

    // ── Feature F: Quick-Swap ──
    const quickSwapBtn = document.getElementById('quick-swap-btn');
    const quickSwapModal = document.getElementById('quick-swap-modal');
    const quickSwapCharacterList = document.getElementById('quick-swap-character-list');
    const quickSwapSearchInput = document.getElementById('quick-swap-search-input');
    const cancelQuickSwapBtn = document.getElementById('cancel-quick-swap-btn');

    function renderQuickSwapList(filter) {
        if (!quickSwapCharacterList) return;
        quickSwapCharacterList.innerHTML = '';
        const lc = (filter || '').toLowerCase();
        const items = Object.values(characters).filter(c =>
            c.id !== currentCharacterId && c.type !== 'world' && c.name.toLowerCase().includes(lc)
        ).sort((a, b) => a.name.localeCompare(b.name));
        if (!items.length) {
            quickSwapCharacterList.innerHTML = '<p style="text-align:center;opacity:0.6;padding:16px">No characters found.</p>';
            return;
        }
        items.forEach(c => {
            const item = document.createElement('button');
            item.className = 'participant-option-btn';
            const imageUrl = getImageUrl(c.avatar);
            const avatarHtml = `
    <img src="${escapeHtml(imageUrl)}" class="${c.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
    <div class="placeholder-icon ${c.avatar ? 'hidden' : ''}">👤</div>`;
            item.innerHTML = avatarHtml;
            const nameSpan = document.createElement('span');
            nameSpan.textContent = c.name;
            item.appendChild(nameSpan);
            item.addEventListener('click', () => performQuickSwap(c.id));
            quickSwapCharacterList.appendChild(item);
        });
        smartObjectFitAll('.participant-option-btn img');
    }

    async function performQuickSwap(newCharId) {
        if (!currentCharacterId || !currentChatId) return;
        const oldChar = characters[currentCharacterId];
        const newChar = characters[newCharId];
        if (!oldChar || !newChar || !oldChar.chats || !oldChar.chats[currentChatId]) return;
        const chatToMove = oldChar.chats[currentChatId];
        // Groups belong to a single character, so the chat starts out ungrouped.
        chatToMove.groupId = null;
        // The chat's main participant is its owner. Left as the old character,
        // the scene roster and narrator prompts kept describing them instead
        // of the one swapped in. A guest who becomes the owner is not listed twice.
        if (Array.isArray(chatToMove.participants)) {
            const guests = chatToMove.participants.filter(pid => pid !== currentCharacterId && pid !== newCharId);
            chatToMove.participants = [newCharId, ...guests];
        }
        if (!newChar.chats) newChar.chats = {};
        newChar.chats[currentChatId] = chatToMove;
        delete oldChar.chats[currentChatId];
        if (quickSwapModal) quickSwapModal.classList.add('hidden');
        await saveSingleCharacterToDB(oldChar);
        await saveSingleCharacterToDB(newChar);
        await startChat(newCharId, currentChatId);
        playSound('swap');
    }

    if (quickSwapBtn) {
        quickSwapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (quickSwapSearchInput) quickSwapSearchInput.value = '';
            renderQuickSwapList('');
            if (quickSwapModal) quickSwapModal.classList.remove('hidden');
        });
    }
    if (cancelQuickSwapBtn) cancelQuickSwapBtn.addEventListener('click', () => { if (quickSwapModal) quickSwapModal.classList.add('hidden'); });
    if (quickSwapModal) quickSwapModal.addEventListener('click', (e) => { if (e.target === quickSwapModal) quickSwapModal.classList.add('hidden'); });
    if (quickSwapSearchInput) quickSwapSearchInput.addEventListener('input', () => renderQuickSwapList(quickSwapSearchInput.value.trim()));

    // ── Feature A: Mood System ──
    const moodBtn = document.getElementById('mood-btn');
    const moodPickerEl = document.getElementById('mood-picker');

    function updateMoodButton() {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!moodBtn) return;
        const mood = normalizeMood(chat?.mood);
        moodBtn.textContent = getMoodEmoji(mood);
        moodBtn.title = mood ? `Mood: ${mood}` : 'Set Character Mood';
        moodBtn.classList.toggle('mood-active', !!mood);
        moodBtn.setAttribute('aria-label', mood ? `Change character mood. Current mood: ${mood}` : 'Set character mood');
        moodBtn.setAttribute('aria-haspopup', 'true');
        moodBtn.setAttribute('aria-controls', 'mood-picker');
        if (!moodBtn.hasAttribute('aria-expanded')) moodBtn.setAttribute('aria-expanded', 'false');
        if (moodPickerEl) {
            moodPickerEl.setAttribute('role', 'group');
            moodPickerEl.setAttribute('aria-label', 'Character mood');
        }
        moodPickerEl?.querySelectorAll('.mood-option').forEach(option => {
            const optionMood = normalizeMood(option.dataset.mood);
            const isSelected = mood === optionMood && (mood !== null || option.dataset.mood === '');
            option.type = 'button';
            option.classList.toggle('is-selected', isSelected);
            option.setAttribute('aria-pressed', String(isSelected));
        });
    }

    if (moodBtn) {
        moodBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (moodPickerEl) {
                moodPickerEl.classList.toggle('hidden');
                moodBtn.setAttribute('aria-expanded', String(!moodPickerEl.classList.contains('hidden')));
            }
        });
    }
    document.addEventListener('click', (e) => {
        if (moodPickerEl && !moodPickerEl.classList.contains('hidden') &&
            !moodBtn?.contains(e.target) && !moodPickerEl.contains(e.target)) {
            moodPickerEl.classList.add('hidden');
            moodBtn?.setAttribute('aria-expanded', 'false');
        }
    });
    if (moodPickerEl) {
        moodPickerEl.addEventListener('click', async (e) => {
            const btn = e.target.closest('.mood-option');
            if (!btn) return;
            const mood = normalizeMood(btn.dataset.mood);
            const chat = characters[currentCharacterId]?.chats?.[currentChatId];
            if (!chat) return;
            chat.mood = mood;
            moodPickerEl.classList.add('hidden');
            moodBtn?.setAttribute('aria-expanded', 'false');
            updateMoodButton();
            await saveSingleCharacterToDB(characters[currentCharacterId]);
        });
    }

    // ── Feature E: Ambient Particle Effects ──
    // Anime-style ambient effects on #particle-canvas. Petals, leaves, snowflakes, glows and smoke
    // puffs are sprites pre-rendered in the Particle Effect Builder (Anime style); the flat ones come
    // with a lit and a shadow face so they can be toon-shaded while they tumble. Motion is simulated
    // here in seconds, so every effect runs at the same speed on 60 Hz and 120 Hz screens.
    const particleCanvas = document.getElementById('particle-canvas');
    const particleCtx = particleCanvas ? particleCanvas.getContext('2d') : null;
    let particleAnimId = null;
    let currentParticleEffect = 'none';
    const particleBtn = document.getElementById('particle-btn');
    const particlePickerModal = document.getElementById('particle-picker-modal');
    const closeParticlePickerBtn = document.getElementById('close-particle-picker-btn');
    // Volume = how many particles, Opacity = how strongly they show, Speed = how fast they move.
    // Each slider runs 1–100, and 50 is the effect's normal look.
    const FX_SETTING_KEYS = { volume: 'particleVolumeLevel', opacity: 'particleOpacityLevel', speed: 'particleSpeedLevel' };
    const fxLevels = { volume: 50, opacity: 50, speed: 50 };
    let fxVolume = 1, fxOpacity = 1, fxSpeed = 1;
    const particleSettingsRow = document.getElementById('particle-settings-row');
    function fxSavedLevels(character) {
        return {
            volume: character?.particleVolumeLevel ?? 50,
            opacity: character?.particleOpacityLevel ?? 50,
            speed: character?.particleSpeedLevel ?? 50,
        };
    }
    function fxApplyLevels(levels) {
        Object.assign(fxLevels, levels);
        fxVolume = fxLevels.volume / 50;
        fxOpacity = fxLevels.opacity / 50;
        fxSpeed = Math.max(0.1, fxLevels.speed / 50);
        // below normal the whole canvas fades; above normal the effects draw themselves stronger (fxFade)
        if (particleCanvas) particleCanvas.style.opacity = fxOpacity < 1 ? String(fxOpacity) : '';
        for (const name of Object.keys(FX_SETTING_KEYS)) {
            const slider = document.getElementById(`particle-${name}-slider`);
            const value = document.getElementById(`particle-${name}-value`);
            if (slider) slider.value = fxLevels[name];
            if (value) value.textContent = fxLevels[name];
        }
    }

    const PARTICLE_EMOJIS = { none:'✨', snow:'❄️', rain:'🌧️', sparks:'🔥', fireflies:'🟢', sakura:'🌸', fog:'🌫️', steam:'♨️', aurora:'🌌', leaves:'🍂', darkness:'🌑' };
    function updateParticleButton() {
        if (!particleBtn) return;
        const character = characters[currentCharacterId];
        const effect = getEffectiveParticleEffect(character, character?.chats?.[currentChatId]);
        particleBtn.textContent = PARTICLE_EMOJIS[effect] || '✨';
        const autoNote = autoAtmosphereEnabled ? ' (automatic)' : '';
        particleBtn.title = effect !== 'none' ? `Effect: ${effect.charAt(0).toUpperCase()+effect.slice(1)}${autoNote}` : `Ambient Effects${autoNote}`;
        particleBtn.classList.toggle('particle-active', effect !== 'none');
    }

    // Sprites from the Particle Effect Builder (WebP, transparent). *_lit / *_shade: the same flake
    // face-on, lit by the key light and turned away from it.
    const FX_SPRITE_DATA = {
        darkA: 'data:image/webp;base64,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',
        darkB: 'data:image/webp;base64,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',
        glowCool: 'data:image/webp;base64,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',
        glowEmber: 'data:image/webp;base64,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',
        glowEmberCool: 'data:image/webp;base64,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',
        glowEmberHot: 'data:image/webp;base64,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',
        glowFirefly: 'data:image/webp;base64,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',
        glowViolet: 'data:image/webp;base64,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',
        leafAmber_lit: 'data:image/webp;base64,UklGRoYGAABXRUJQVlA4WAoAAAAwAAAARwAARwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBI7gEAAA2QLUm2aVt9bF/btm3btm3btm3btm3btvm2MUeP+QERMQFgLIvtsGLMSej02gq7gXUlbTAVQMZm7fUVSQMA7R5u1xZzFhzOGvha2WY4jjehhq4xcF6geH9NRbK6gH47zyuaCpcXNdLTAK6nyztbS1gPN9Bj9mclneFukirjdMRs6hZ6LnqtYhrc9xnaS0PWxAbQ6Op5BfNgdFQvvrQ+Zop9PE/XGYabzmcLLWls7Rey6jDtW2UVWRdjaD2TKy3MZ/I6T9VZAE3nM4WWFFn7hSg3JH2zHycqKYKSu4lyy2S+yBOaRibXKZ7ckPUtutMSyH2SJpdUjjM0haUKH6TxlfL9w5IW4vGfkoTLpbxNEk3O9w+Jr1zQd5JQubDPJPHl4j8leRpf7DNIv4SKPWX5GCH2iuVMDrFHLF9CxZ6y4GOE0HvQHs8rdJ5na3mhtTybS/ta4vXtAiJ7QLy2ushaps2lfS3x+mw5gfWgbjPJ19jXXlyvh0011gXkc5IUM3TlDBt6DfUx8rch6M+PXu5j4G8NKNy0aEmoW18bQOWOYWviufGwDpRebzg/o0t3GkHt65IpB6ZxcmD+OWheMzigVzUAB3pC/flR4XPR4TpseDslbsCKR/PjnB3w+T8sedrLFi9/2eKYvy1eedviaBAFVlA4IKICAADQEwCdASpIAEgAPjEWiUKiISEWbmTMIAMEsQBqJoAdaNeHjn4ufhh05W0ndX8Tcxi4K/of5Z/1z6j8oB+lP9Q/wHAA/QD9sfYz/wHoAf273AP0A9ADrFv1O9Tr+e/6f8////9hP7AfsP8Bf6m/+5PgFpbPQnImBet9bCeYBKAPYNU7r3rnWkTb6zF+S6P3acSH5y+hgXtR71SlNpCoLIsBYcSZcDLdGAD+/u6zZLmO/HhjibLEYiaUdKWKHV1hz3hIM9eD9RKEDA9ZP4+7zEoP5YMYVGIXQnH249UXRCAS1FJVGZ7ZPNHDHSjU7My5D9jQ0v7vwUugraIWVn8YnjRoq9kaK//9/uILbNX2aSP52E+HtVZGNeyBRZkZv0q0pf//r0kt29jda9zY3/97plRZlD7/+KS2+TOFZccGElSkT++oHuWBTNffQ97CYiBfkRZb0O6OwioXQHQJq/SVheyGLMC6g2BdLqHPXbIPQHjtNkk0UYLf3tt+VOscThvW6N9nLZl7u5l9giA//3YLY/eqixDbY7/fDcPZzE2/7ZsBXy7qorHb/ibPl7mBkSpuVrfzD0LI8J/AADYY1O/8ErrF08LrOkC4PUQjx9dXJb9min/0PmiPsBVm7feT+WyJf7l9uuaKjognhF3G2pxR4BUxOCHplc0KWeAAGFbdHnJ//xzywVeL1ZmMePm5oWFPnknQ5ern//5CcFa31nQUZaB7XINpW/R4dMydoLmmhrNDi2ZcS+AsBc40GZ0Kf+UB+PKjehKmOgP7R+KWJkeYzfZdKr64tNKW14Yg+qQwL/vtNMMzbQVHXA3zpOGnuOjbNFwAkBmO7Vixnp///3uTKNwHSPTHel8I3+imLcHGZquPbiCXnpUppoehETzp7ePQAAAAAA==',
        leafAmber_shade: 'data:image/webp;base64,UklGRpgFAABXRUJQVlA4WAoAAAAwAAAARwAARwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBI+wEAAA2QLUm2aVt9fI+tt2vbtm3btm3btm3btm3b9r1rjh7zAyJiAsCYF1thxbCxaPrUCmuAmcVsMAhAxlId9GVLDwBtTm7TFjYFf7pN6vhU2VL8PWb/yrp649/5MvTVlDX7f6DnypOKRuJ/3cY11FMO/58h0Uwtft0doPPot0oaw2m8IiN1hDZzhM6TnqkYCefeXbtoSJnQABocOqlgPIz27coXL8xMkVtn6VrBcL0pbH6FTNVa8pasFEz7519G1twY6k/mihdoLvOrc1StIFh/MpNfIYlaS94SpYOkf6LDRPlEkG8LUUaZ9Id5/JLJZDrAkwqy3ul202QVQrY9NJmkMhyiySKVZR9NiFTIc5Z4EI96SOIvF+sGSbCcxxcSH7nQZyRhckEvSaLloh+QPIgWewPSp2FiN61xj+VMMrH7LG/dYwh9fMmCp2FCT0B7OL3QSZ7VxYWW8KzN4y3ydQ3Ps1O5RTaAeEk5kSVMa/N4C3xdw/RsV2mBBaBuMdDb2NN+XM+6TjDWBuSzwooYOnCFDR17eBv50BD0Z7vP8zbwoTwUbhw3J8jRy2pQua3T/LgOLtSB0ivVRmT6r+MtoPZZsfDuaf6xfsptaF7d+1ubiu7A+i5Qf3KY5zTUvwcbnk+Ms7Di0VS4YAc8+g5LnrbG9W+2OOZli+uetjjGAQBWUDggpgEAAFANAJ0BKkgASAA+MRKHQqMhDC7GKhgBglAGoEDnwD8XPyO3wGGBfJfxr/s28Af0ndAfoB+gHsS/4DrAP0A4DP9bvQI/2H+A+BD9Hf0z+Ab9JwZeRcSRwS33gvJgKQQ0oCNvNX/PZ7aTUFBXcIRJ473tGAAA/v7usw+qCfwf8eVYQyu2djE2PM7zLHH7x94JB/R1Vo+hWphxJiMdCt8lPqixYqtv9d6dmM/dCqE9AvywvcKVAjrAydZJP//y5Flte5rwdJdsP/xGWEeSSf/TqUVBv6ZPLcYHAvsHx/V/5lpzVvX+0k/8s431GbUFNedSuaQVFCcf//5s1epnkD3HYfoFaJKVqy3wduRz/b4A+z7e+N+6NFd3Ur+IIGiBmD+h4Y3ODnSPihYt4UU4DgvVwsgWnghbKQLnKvvDDgZnMYa0vIGA//8/PhSjjGTnTsb+BMViw78zez9/H2xXl/2YEVZdqdHJLMCeSsMu7veqzaT6v7Mk+AHEodJFA7Cn/qjrbHuwWdeMaEiStHoC7R26YpH//+T8qCZfpSfCeJbW9ag/X9G0IAAA',
        leafBrown_lit: 'data:image/webp;base64,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',
        leafBrown_shade: 'data:image/webp;base64,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',
        leafGold_lit: 'data:image/webp;base64,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',
        leafGold_shade: 'data:image/webp;base64,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',
        leafOlive_lit: 'data:image/webp;base64,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',
        leafOlive_shade: 'data:image/webp;base64,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',
        mapleOrange_lit: 'data:image/webp;base64,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',
        mapleOrange_shade: 'data:image/webp;base64,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',
        mapleRed_lit: 'data:image/webp;base64,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',
        mapleRed_shade: 'data:image/webp;base64,UklGRj4IAABXRUJQVlA4WAoAAAAwAAAATwAATwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBIAQMAAA0kAUmKyoiIRhptW2ck3UHhq7Z7bNu2bdu2bdu2bdu2bXtSq+1OviTv+1b/jogJYBPZtpPn4Qv4H3RkixigiwoylDmDAXo6WgTch4KImACmkW07OT+Aewr1y6H/DmgAlXOmgatQETEBoJnsfEa8LP0F0ky2DUDG1fV/ysJtE+JnXFZXkcRUqOduPlQOrV010P3PFhkUbg/OVQvuiuc7E7xsVe+fwq0Af7YePYULZnyIgvA3Cuk4Kt6FUjquiHczu4PrY7B4OFSD6zwkeLo81ykZ+IDb55cEUvOleSebDK8kkJYv83MhCvpGHedJw5fsC08517cPzKtaLlVRX0BZepqD8bFgjvL9kTbTu+t3M76wBjUaQt1j48h7GpmhM9kXjTwTAdjTFJauvgcJqAc4Hdu6fVTT7aaopVwCbWFID/QkGwdSbZq53xjNNq3BPRD4SDUepJtbfPpSxSCfrq2hs0E9ysEF+A7ucHbvSUWPq61SxSrQfaHe/CrIB1hq1S3zXs/2UjBwJvjyznoAWJLpyQAjA9yeqkwfyc/H/XxQToiUGHc0EiLk2FXZTYCn5VAa1KyamdiLsiDWq1uOOmv1ykHmxrJD+OHnAwu69iSycD2o9oqaayEQPDwCdBfv38NMC24E0qdn72AmBTcC8dOzdzBTghuB/OnZGz1NCGoMAU93X1XCsEvNIOS3zqt9DPrVHmKWnASjfQ70uSFAjQYpYHzm5Y/2niA2bBzMdbStW3bsZFL9Yb6l12xKtUDRJ89pQo1IoPlmOm5ViBxQyOSBdtCSfxZriSIWlaCHxxDu0dpPg+W6TqaY1tLJQHjYpUd5OjfD7oWPAODf7sFd1ZD/NplnX0omjbfyFlSdN+1FcS4Kqs5BBTrGizidDGT3z3mVJ32B9K8uQtsVcHWqAZ0KFLj/7P5dkP5y6/Wt1zC+2y0kOH0An19SSQQkipaKfBlgCZeKBWDBUpFvIiBRtFTcADdFKglfA5ukJEi1FL0O3CfFoGik5Kh14D4p1c6F1LLltwoAVlA4IEYDAAAQFQCdASpQAFAAPjEWiUKiISEWaZ2YIAMEtQMUAFa/lR8N/E38t+sC4N7m/uH0hxXOr/7N/AP2g/s3059B/mAfo//n/x0/gHwAepTzAfph/xvWg/x38z9wH+Z9QD+s/y30gPZ69AD+Kf2D0yP9f/ivgc/a39X///8if8i/of/bT8Rqn/dza8SW6q+wcgmwiEm61O4RNQBOWEK/a3e5noUU/dsKrF29mos0rDuvkMo4bCAA/v7utA9zXketvPzYwIEmATtHKM0iyHbyu4CbF//+cWgimWPbdSWsSZE4QLRxxwFI///soZ23fLBq5hEpE/ZQddu+P9ejWqSr++lMA5KpR9XmOPK/IHa4//+Lb+/VZVAdEqXRDh6Tm4RQPRX0eDZyJRAvK8jUi4oXax/Brp+JljvUjU5ewwsyZoNJ60wAaElpEtJ8JiL/CxdcV1BwLNvG+X+jTq/ByEv/x1oe8MHZGCX6CzXtbzSqgNMPfaBa8+oPNwxQq9Q6gDPCreO5mvoJ3vE+VS0eHRQ0M08bSf+L1AH3uwfkXTNcqlnLzIfxjz+Ue7qfPckvORH/8igd0qk7p1NhKovTU67r2QVPq00P3G/E5ukBJ0oBxI/DJVI94N1u2b15jQ2un2+fhX/pO+0To0k1mFyPMPWTpIVX27g+XS3XC6qBvXxxykc8BW/gmNnuc78kHp6250e2RjSWUu3EXXeCxNoXWLRFAjxgg/x56I8M1hdN20vgWXC/cW1dxNvjxi/S0SH1h6OQcVsI53eEkAw7lQ6/aLqWdTBe0qk49McuvnUnP8cBOC9OKTyP78pCAy+z+rTfovLLcvv0pPQOsZsByA0h+CTxY6X54yhPT1FGn4J/7DDsxf6oGvGVM8dY+ECzbT71oyGJcLtJn+DePuPH//C17cbr1KFthAeHEf/8J/wKXn5lG7WCXktzMY4F9Al1HPv2n/s8f7W+VwT2D/v3Ii3MrXwVXxqw7Pm0RX5m6N8gn6S+FDjYmSdRkD3QN0cK+OBc4z6xLydEBX2N3/6Gj//4PzOpDIUHbsezk7zXlZYsNhBITWJcDC6k7ZZ3JFi2QuuCwJsAKu///QYTST/pKLXRTqPB3I0zBXr/sZcMkAAA',
        petalA_lit: 'data:image/webp;base64,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',
        petalA_shade: 'data:image/webp;base64,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',
        petalB_lit: 'data:image/webp;base64,UklGRsIFAABXRUJQVlA4WAoAAAAwAAAAPwAAPwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBICgIAAA2QbNu2aTvz2bZfbNt2UrJt27Zt23ZSs23btp2Dteb5gYiYAMinS/6yF8bFvC/fA3nu9tUB70mbDBo1QoaQtTNPEKWbEYj/13R4AiC+B4CA6q3vDrrA0qotjD22lQOwHcZV+y4fz7EcFrO2aIdZMPcYGVOXIGguLLe9+zm1BaBOwxpv1WbA5sxoWC9buYNWP9iNh90GicN0MtWyJThgxwmVNdD3WFRXox8Y05acpVCbAj3GyNUAZ4qM28WakqDzRKmgvCxF90nlB6tH2e1C1WlQeZtQPE/YS6F0PEX2CyXyhL6SSQCvp89bkSQi5D0m4sMk/NuF6LPM4xii1zLvAoneydxPILovg69eNF8hfCkjzSmp0zlobkgdKkizV+pBPM1NqcO5PEl+n5Z6d74QyWGI7ylLskZuaxWSPXIXXTJSXIDi2uoUu5z2a5HGxQflCHZDdV4zgnk667KnVnu+XwfL6qlNhvKMpl5Kr5dpPZ8+SGk81OcXS63yepne83m9VUaBcEHR1ArXNzKg7XSFXqDc876q2KZfHGg9PFTodS+QPh8zVqgdaBfElhfZ8oEHDQakFrgzDMTPe033tvW1Jaj3rZhlqxXIF39uZWMu6FvXLWzp0Ho+VByS28LJvnDg+xpjM5tc7AZHvqgxJbPBxXZw6POag4oC2D8Ajn1erU5LTF8NJ7cKxgcoA1ZQOCDCAQAAUAsAnQEqQABAAD4xFIdCoiEM/mYAEAGCUAZif2HvJWtCA/gHWu+gB5X3sQftt6YBMqGIODIHo/OzeL3R79BiNrMxMLdlWUcoVfMhM5KOTxvPwQj7q5gVNjt5CAu7G9xmzaXwAP7//hiu/8bDjTskeCHDnQ/9PBJNNodI4tsLwc0wiYcvvQyqn8000+7DGX/4k6r018efEggXTNoVXKVlk/H5o4UTvgIphP9Gn3nXO8B8Z/D5nD8ZAYf6iLWLYBXXYs88Pl1FVbmoKRypxwXMQEy8XX8EcDDRtg8Sr43nXZOZtLeo/b7XP9XxvoqW+Ep//+jtvRbhxEJS9lqe2lWjaQTi9YWaZZOvL/VtSI5nLvBg/IxlCkiESj8gyomqmsYrGktZ/MfaX6/T0tnz7FYdYTrUVbJ6+xoqhwNRs46XHJTXsIVAERqjtHji18d6eGdlRgD82w10wlIQSnprtw1ldw0rlGh19k38CskKdNbjWeElBufsqq/3/N/AgWAJTomk/zfAIFSvviKXZVhphf/GnLzz6fNUncOg9gLkxjPZgE+/+5Dr82OFCmPTGPnmTBV2fotozUfY1qB5fHht/9f6AAAA',
        petalB_shade: 'data:image/webp;base64,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',
        petalC_lit: 'data:image/webp;base64,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',
        petalC_shade: 'data:image/webp;base64,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',
        puffA: 'data:image/webp;base64,UklGRtIJAABXRUJQVlA4WAoAAAAwAAAAfwAAfwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBIcgQAAAGghm17GWnL2vps27Zt27Zt27Zt21ijnVl7R09nx9jp1nk+DNpJ5vcbERNAlrS8YpWTjlutdC23yykfzOmG2nPXFuWlaKkvFyjm1H7bsrXkLPsZxXyt7z5aqrRs93yAYv7df+5fwIm7rrBCY2sltxomsODYe1vktfyLppHRNUM8YpXNr+oWb92UO2vKhWH7KnldRzE7VSkiov7Jppy5GG2kvdvnc3CuPGeX58uYHYje62pznYU2XsuVldL2oHHf2tluztgx18iTPahNaEYeXoYQsmoKbb2PJ9uZdiHi3HaE3I32qodz5HV0cny1xr9swuTJ3GiJOoIhd9IuNC/jxVKyM45qe3GiNs0MtvOh4SHKjp8LW04jw3/zYF1Alrsr2avrRKahgr2zKFvKiswtNY2M787c48j6haxtpLCm78zam8i6p5KxpfzMDRDG15ZZk05jjbQb8ZDJDnVvT5h/bWIiILPTvgxh/2DRt6ixYwrbs1cnGNSgzCD+vRZz5FUtqiPLvY3MHZD2RkJqPlSxiguvZG4d0e0FSOdhxOW4VlSvMlf+pjjug1geVNMgbBXTVcyRE1ySZlE1F6qJJEhphRbNTeyt8JeGphWScyHVJZAgTIvldfbIXR4lGgTI5EKMQWQxlKBF0l3H3p5uD/w/mYcRD8rmYrEoPxxVxlr93zP+/0E0o5pZ0FLno1axIPp2Zo18NDw9O+Pxg2QtRvQsiNQ0i8c6nbmDB9xD7qHxWaDI6GHM1XwopHyCOOyNa4xsxxw5qSPQ8Xm3MBGCoMbE6ezV3/rYCm3Xe2ctFSBBGTiNPbJsfVnjtSkFMRaAqFWAQp2jW3GAkKVPOOan6QRi2A9hmisjI0aCcTluOhOq5ELlNuu/LQwqaMmL6TyohajMA4CUtpx4mfBxw6Mf7xOiaCfVF5SMEjXsM3biROu+1wQ0y5bslm7fK4Sb60cxJzVpYXZTxJE2fmwyFDERTUNVqBKyisNSMLU54eiD4oyqBSWAKGaitCjQhJ0IT/cbGJtHRC0MKsaktE0UowumklFoFu+6hKv17YOeCCKiqiJNRWzSrbgkAUAoFteRnkE4++OIF/7noKWF06FgPOTzB/wzQ7H3q3nzlmtOdkgLA0AgMD01OT4qTZ5URnh7ijCRdkiP+72z40OiKAj9z65J+Lv5wIhkOIOyZ1js//i6i47Zb2PC46U6hvwhh/Shrw5dp5zw+4dBHySdoY+2EK4/6vY6JVYTvu83MAUR6shZhPPVL7rmIENtohSxq5Z3ZL3uYX9QMWlhVFkIxhDfJPy/R5gMQDytWpTqNB8rBAGvjO+WgLq3xHEfgBSNSiClzVyoheVpz1ctJYAs/XDfyIwvAFlDyv+onIjLM7Phd5tISSw7+HdxZGrW4/H4AgFIaEpmHnyeCdfAV8uRUrn8KW92C67BodHJGW8AAPyTg27h7/NbSCldftszb/hUEMXB8cnZmRFREH7YlpTepv1Pva9bEERRaH/ulKVIid7jw2/feub4FcgSXQJWUDggagMAADAVAJ0BKoAAgAA+PR6NRKIhoRHJJQwgA8SzgGq9mqBiFefH25HiZ9TnePPQA6SX9x/Sc1WXyhZbxslwqAr2a6gH8h6gnoMfrMQNgk9gnuIS0RoZFBQueF70GWBR1p8KjxwO6Q3QxHSa/gt11BhGjczGfUeR+YDr8QWKUMzVc2NLajQlEwUBFCcknPHXCntWa0BSJ6cI4Ji+4KlTsYqKD4WovFaOyfxt4HqKLCSU/lBy3wAA/v5HgABgf/7OEnF6AIJkJPVonkjkIkIrtH73VxD0MiX+gDE//2w3FoTE+qYOIOAeVmz+HwA3EUzQltrtcq2p/CQFz/tGztNs7H0swkKXBZgcjBU3XsqiBv/qwLuzkea83Dzag3cpWl6xMrFnKOMnpwO6pvpKA+MdkONep597vpX1qfs/8v3l3ebf9FnNbxhd3i4YvW0yIEGlyqryxmposbkt//3eP5VizwaYrENNUpslQLvPCTsSSdXF7J2LQJVgDCtKdHI+c9Oj571xG1rnq+2+8OPlDgssYKml4KFN4sCLeqxF3NXgxlGwnqub4H83AMg+aMM/cA0mqZTfH+xv9GOCokrhwTmgMlQF43pLGDioKLdiEa+Mle0zbD7lvGbAP/Jmcu7tGlmp9l58suRgWFT9wJNcodXwgMS95mKIOGdd1F+joUH/334P6tXqwSQLP9D4sZTu6Z6vNitsLhLwEIrbcM8n7s7e6nlAJtZEuHtUG0Md0w7JnrE94ak2QFKvWx+cKLvBOGJHRL++Lc58DKCmPjQSZ7v4XfcxemrCkwY0LI8GgSqidOvt+5mk5NW2kFh8XVBHSUapyr/lL/MzDtZYkjl9hms4OIYYa7lPUsopwY+IoGkLUtl1GuM7wE8G8E2knEDfo8e3CRaRdzyBTaVpVykzIA5afL7vkXcFMY7APga/RzO6MnfuZMnFNwXpUwETVk5soIaLL4xdEReX97ih/DjeFhRQmiqvZcylFcF+//V958J/bXTQ9WyB3cTHGgLJOrwEY39eUpCozNIs6tX9HQdfM5t21Ju7iV+wGO1n+iH0NDWgqDAMEOL1Imo6crpW2vuj/xnnw0NzABRbG8fHsWJNuSCWVWeDzTCj5aM2MfMxU0Pb7mf8/HQLTcNic2DYNKeoM3kLC9ASYyh/72qAAAAAAAA=',
        puffB: 'data:image/webp;base64,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',
        puffC: 'data:image/webp;base64,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',
        snowflake_lit: 'data:image/webp;base64,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',
        snowflake_shade: 'data:image/webp;base64,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',
    };
    const fxImages = {};
    const fxCache = {};
    let fxSpritesReady = null;
    function fxLoadSprites() {
        if (fxSpritesReady) return fxSpritesReady;
        fxSpritesReady = Promise.all(Object.keys(FX_SPRITE_DATA).map(name => new Promise(resolve => {
            const img = new Image();
            img.onload = () => { fxImages[name] = img; resolve(); };
            img.onerror = () => resolve();
            img.src = FX_SPRITE_DATA[name];
        })));
        return fxSpritesReady;
    }
    function fxCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }
    // A blurred copy (depth of field, soft fog). `fxPad` = how much larger it is than the source.
    function fxBlurred(name, radius) {
        const key = `${name}|${radius}`;
        if (fxCache[key] !== undefined) return fxCache[key];
        const img = fxImages[name];
        if (!img) return (fxCache[key] = null);
        const pad = Math.ceil(radius * 2.5);
        const c = fxCanvas(img.width + pad * 2, img.height + pad * 2);
        const g = c.getContext('2d');
        if (typeof g.filter === 'string') g.filter = `blur(${radius}px)`;
        g.drawImage(img, pad, pad);
        c.fxPad = c.width / img.width;
        return (fxCache[key] = c);
    }
    // Small procedural sprites: a four-point sparkle, a rain streak and aurora curtain strips.
    function fxSparkle() {
        if (fxCache.sparkle) return fxCache.sparkle;
        const c = fxCanvas(64, 64), g = c.getContext('2d');
        const glow = g.createRadialGradient(32, 32, 0, 32, 32, 14);
        glow.addColorStop(0, 'rgba(255,255,255,0.95)');
        glow.addColorStop(0.35, 'rgba(235,245,255,0.35)');
        glow.addColorStop(1, 'rgba(220,235,255,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = 'rgba(255,255,255,0.95)';
        for (const [w, h] of [[2.2, 31], [31, 2.2]]) {
            g.beginPath();
            g.moveTo(32, 32 - h); g.lineTo(32 + w, 32); g.lineTo(32, 32 + h); g.lineTo(32 - w, 32);
            g.closePath(); g.fill();
        }
        return (fxCache.sparkle = c);
    }
    function fxStreak() {
        if (fxCache.streak) return fxCache.streak;
        const c = fxCanvas(8, 128), g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, 'rgba(200,225,255,0)');
        grad.addColorStop(0.7, 'rgba(215,235,255,0.55)');
        grad.addColorStop(1, 'rgba(240,248,255,0.95)');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(3.2, 0); g.lineTo(4.8, 0); g.lineTo(6, 124); g.quadraticCurveTo(4, 128, 2, 124);
        g.closePath(); g.fill();
        return (fxCache.streak = c);
    }
    function fxAuroraStrip(key, stops) {
        if (fxCache[key]) return fxCache[key];
        const c = fxCanvas(16, 256), g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, 256);
        for (const [t, col] of stops) grad.addColorStop(t, col);
        g.fillStyle = grad;
        g.fillRect(0, 0, 16, 256);
        // feathered sides, so neighbouring strips melt into one curtain
        const side = g.createLinearGradient(0, 0, 16, 0);
        side.addColorStop(0, 'rgba(0,0,0,0)');
        side.addColorStop(0.5, 'rgba(0,0,0,1)');
        side.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = side;
        g.fillRect(0, 0, 16, 256);
        return (fxCache[key] = c);
    }

    let W = window.innerWidth, H = window.innerHeight, fxDpr = 1;
    let fx = null;
    function resizeParticleCanvas() {
        if (!particleCanvas) return;
        W = window.innerWidth;
        H = window.innerHeight;
        // soft, screen-filling effects don't gain anything from a retina canvas
        fxDpr = Math.min(window.devicePixelRatio || 1, fx && fx.lowRes ? 1 : 2);
        particleCanvas.width = Math.round(W * fxDpr);
        particleCanvas.height = Math.round(H * fxDpr);
    }
    resizeParticleCanvas();
    window.addEventListener('resize', resizeParticleCanvas);

    function stopParticles() {
        if (particleAnimId) { cancelAnimationFrame(particleAnimId); particleAnimId = null; }
        fx = null;
        if (particleCtx && particleCanvas) {
            particleCanvas.style.mixBlendMode = '';
            particleCtx.setTransform(1, 0, 0, 1, 0, 0);
            particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
        }
        currentParticleEffect = 'none';
    }

    let fxStartToken = 0;
    function startParticles(effect, levels) {
        stopParticles();
        if (effect === 'none' || !particleCtx || !particleCanvas || !FX_EFFECTS[effect]) return;
        if (levels) fxApplyLevels(levels);
        currentParticleEffect = effect;
        const token = ++fxStartToken;
        fxLoadSprites().then(() => {
            if (token !== fxStartToken || currentParticleEffect !== effect) return;
            fx = FX_EFFECTS[effect]();
            fx.t = 0;
            fx.last = 0;
            // light effects (glows, aurora) add onto the chat background instead of covering it
            particleCanvas.style.mixBlendMode = fx.blend || '';
            resizeParticleCanvas();
            particleAnimId = requestAnimationFrame(fxFrame);
        });
    }

    function fxFrame(now) {
        if (!fx) return;
        // the Speed slider runs the effect's clock faster or slower
        const dt = (fx.last ? Math.min(0.05, Math.max(0, (now - fx.last) / 1000)) : 1 / 60) * fxSpeed;
        fx.last = now;
        fx.t += dt;
        const g = particleCtx;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
        fx.frame(g, dt, fx.t);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        particleAnimId = requestAnimationFrame(fxFrame);
    }

    // ── helpers ──
    const fxRand = (a, b) => a + Math.random() * (b - a);
    const fxPick = (list) => list[Math.floor(Math.random() * list.length)];
    const fxSmooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // how many particles for this screen: the counts are tuned for a 1280×800 window
    const fxCount = (base) => Math.round(base * fxVolume * Math.min(1.5, Math.max(0.45, (W * H) / (1280 * 800))));
    // particle size for this screen
    const fxSize = () => Math.min(1.25, Math.max(0.75, Math.sqrt(W * H) / 1100));
    // extra strength when the Opacity slider is above normal (below normal, the canvas itself fades)
    const fxFade = () => 1 + 0.35 * Math.max(0, fxOpacity - 1);
    function fxSync(list, target, spawn) {
        while (list.length < target) list.push(spawn(true));
        if (list.length > target) list.length = target;
    }
    // Breathing wind (1 = normal) with a stronger gust now and then.
    function fxWind(t, seed) {
        const breeze = 0.6 + 0.25 * Math.sin(t * 0.21 + seed) + 0.15 * Math.sin(t * 0.57 + seed * 2.3);
        return breeze + Math.pow(Math.max(0, Math.sin(t * 0.12 + seed * 0.7)), 10) * 1.6;
    }
    // A sprite centered at (x, y), turned by rot, w × h pixels (a negative w mirrors it).
    function fxDraw(g, img, x, y, w, h, rot, alpha) {
        if (!img || alpha <= 0.004) return;
        g.globalAlpha = alpha > 1 ? 1 : alpha;
        const m = w < 0 ? -1 : 1, c = Math.cos(rot) * fxDpr, s = Math.sin(rot) * fxDpr;
        g.setTransform(c * m, s * m, -s, c, x * fxDpr, y * fxDpr);
        w *= m;
        g.drawImage(img, -w / 2, -h / 2, w, h);
    }
    // A glow stretched along its motion (a short speed streak), long = extra length in pixels.
    function fxDrawStreak(g, img, x, y, size, vx, vy, long, alpha) {
        if (!img || alpha <= 0.004) return;
        const sp = Math.hypot(vx, vy) || 1;
        const cx = (vx / sp) * fxDpr, cy = (vy / sp) * fxDpr;
        const len = size + long;
        g.globalAlpha = alpha > 1 ? 1 : alpha;
        g.setTransform(cx * len / img.width, cy * len / img.width, -cy * size / img.height, cx * size / img.height, x * fxDpr, y * fxDpr);
        g.drawImage(img, -img.width / 2, -img.height / 2);
    }

    // ── flakes: petals, leaves, snowflake crystals ──
    // Each flake is a thin plate with a full 3D orientation R (row-major 3×3; columns = its axes on
    // screen: x right, y down, z toward the viewer). It is simulated like a falling leaf: air resists
    // motion across the plate far more than along it, so a tilted flake glides sideways, and the flow
    // turns it broadside, it overshoots and rocks back: the flutter. We look down on the scene a
    // little (FX_VIEW_PITCH), so flakes lying flat are seen face-on, not edge-on.
    const FX_VIEW_PITCH = 0.95;
    const FX_FALL_Y = Math.cos(FX_VIEW_PITCH), FX_FALL_Z = -Math.sin(FX_VIEW_PITCH);
    const FX_LIGHT = (() => { const l = [-0.42, -0.62, 0.66], m = Math.hypot(l[0], l[1], l[2]); return l.map(v => v / m); })();
    function fxRandomOrientation() {
        let x, y, z, w, m;
        do { x = fxRand(-1, 1); y = fxRand(-1, 1); z = fxRand(-1, 1); w = fxRand(-1, 1); m = x * x + y * y + z * z + w * w; } while (m > 1 || m < 0.01);
        m = Math.sqrt(m); x /= m; y /= m; z /= m; w /= m;
        return [
            1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
            2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
            2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
        ];
    }
    function fxRotate(R, ax, ay, az) {
        const a = Math.hypot(ax, ay, az);
        if (a < 1e-7) return;
        const x = ax / a, y = ay / a, z = az / a, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
        const m0 = t * x * x + c, m1 = t * x * y - s * z, m2 = t * x * z + s * y;
        const m3 = t * x * y + s * z, m4 = t * y * y + c, m5 = t * y * z - s * x;
        const m6 = t * x * z - s * y, m7 = t * y * z + s * x, m8 = t * z * z + c;
        for (let col = 0; col < 3; col++) {
            const r0 = R[col], r1 = R[3 + col], r2 = R[6 + col];
            R[col] = m0 * r0 + m1 * r1 + m2 * r2;
            R[3 + col] = m3 * r0 + m4 * r1 + m5 * r2;
            R[6 + col] = m6 * r0 + m7 * r1 + m8 * r2;
        }
        // keep it a rotation (Gram-Schmidt on the first two axes, the third is their cross product)
        let l = Math.hypot(R[0], R[3], R[6]);
        R[0] /= l; R[3] /= l; R[6] /= l;
        const d = R[0] * R[1] + R[3] * R[4] + R[6] * R[7];
        R[1] -= d * R[0]; R[4] -= d * R[3]; R[7] -= d * R[6];
        l = Math.hypot(R[1], R[4], R[7]);
        R[1] /= l; R[4] /= l; R[7] /= l;
        R[2] = R[3] * R[7] - R[6] * R[4];
        R[5] = R[6] * R[1] - R[0] * R[7];
        R[8] = R[0] * R[4] - R[3] * R[1];
    }
    function fxNewFlake(p, spin) {
        p.R = fxRandomOrientation();
        p.vx = 0; p.vy = 0; p.vz = 0;
        p.wx = fxRand(-spin, spin); p.wy = fxRand(-spin, spin); p.wz = fxRand(-spin, spin);
        return p;
    }
    // windX: px/s to the right; fall: px/s along the (tilted) vertical; flutter: 0 = drops straight
    function fxFlakeStep(p, dt, windX, fall, flutter) {
        const R = p.R;
        const nx = R[2], ny = R[5], nz = R[8];
        const kd = 1 - Math.exp(-2.4 * dt);
        p.vx += (windX - p.vx) * kd;
        p.vy += (fall * FX_FALL_Y - p.vy) * kd;
        p.vz += (fall * FX_FALL_Z - p.vz) * kd;
        const rvx = p.vx - windX, rvy = p.vy, rvz = p.vz;
        const rn = rvx * nx + rvy * ny + rvz * nz;
        const kN = 1 - Math.exp(-5 * flutter * dt);
        p.vx -= rn * nx * kN; p.vy -= rn * ny * kN; p.vz -= rn * nz * kN;
        const rl = Math.hypot(rvx, rvy, rvz);
        if (rl > 1) {
            const sg = rn >= 0 ? 1 / rl : -1 / rl;
            const tx = rvx * sg, ty = rvy * sg, tz = rvz * sg;
            const K = flutter * 60 * Math.min(rl / 110, 1.5) * dt;
            p.wx += (ny * tz - nz * ty) * K;
            p.wy += (nz * tx - nx * tz) * K;
            p.wz += (nx * ty - ny * tx) * K;
        }
        const damp = Math.exp(-1.5 * dt), kick = (0.15 + 0.35 * flutter) * 4 * Math.sqrt(dt);
        p.wx = p.wx * damp + fxRand(-kick, kick);
        p.wy = p.wy * damp + fxRand(-kick, kick);
        p.wz = p.wz * damp + fxRand(-kick, kick);
        fxRotate(R, p.wx * dt, p.wy * dt, p.wz * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    // How much of the visible face the key light reaches (-1 … 1).
    function fxFlakeLight(R) {
        const f = R[8] >= 0 ? 1 : -1;
        return (R[2] * FX_LIGHT[0] + R[5] * FX_LIGHT[1] + R[8] * FX_LIGHT[2]) * f;
    }
    // Draws the flake with its current orientation: the lit face, then the shadow face over it as
    // the plate turns away from the light (toon shading: a narrow band between the two).
    function fxDrawFlake(g, p, lit, shade, size, alpha, shadeMax) {
        if (!lit || alpha <= 0.004) return;
        const R = p.R, k = (size * fxDpr) / lit.width;
        g.setTransform(R[0] * k, R[3] * k, R[1] * k, R[4] * k, p.x * fxDpr, p.y * fxDpr);
        g.globalAlpha = alpha > 1 ? 1 : alpha;
        g.drawImage(lit, -lit.width / 2, -lit.height / 2);
        const s = (1 - fxSmooth(-0.08, 0.3, fxFlakeLight(R))) * shadeMax;
        if (shade && s > 0.02) {
            g.globalAlpha = Math.min(1, alpha * s);
            g.drawImage(shade, -shade.width / 2, -shade.height / 2);
        }
    }
    // Petals and leaves: a depth-sorted flutter field blowing across the screen.
    function fxFlutterField(cfg) {
        const list = [];
        const S = fxSize();
        const spawn = (initial) => {
            const near = Math.random() < cfg.nearShare;
            const d = near ? fxRand(1.3, 1.6) : fxRand(0.55, 1.15);
            const v = fxPick(cfg.variants);
            const p = fxNewFlake({ d, v, size: fxRand(cfg.size[0], cfg.size[1]) * d * S, near, ph: fxRand(0, 6.3), sf: fxRand(0.9, 1.8), sa: fxRand(0.6, 1.2) }, cfg.spin);
            if (initial) { p.x = fxRand(-20, W + 20); p.y = fxRand(-40, H); }
            else if (Math.random() < 0.3) { p.x = -40 * d; p.y = fxRand(-40, H * 0.7); }
            else { p.x = fxRand(-W * 0.3, W); p.y = -40 * d; }
            return p;
        };
        return {
            frame(g, dt, t) {
                fxSync(list, fxCount(cfg.base), spawn);
                const wind = cfg.wind * fxWind(t, cfg.seed);
                const fade = fxFade();
                for (let i = 0; i < list.length; i++) {
                    const p = list[i];
                    // the air around each flake eddies a little: it sways as it drifts
                    fxFlakeStep(p, dt, (wind + Math.sin(t * p.sf + p.ph) * cfg.sway * p.sa) * p.d, cfg.fall * p.d, cfg.flutter);
                    const m = p.size * 1.5;
                    if (p.y > H + m || p.x > W + m || p.x < -W * 0.4 || p.y < -H) list[i] = spawn(false);
                }
                list.sort((a, b) => a.d - b.d);
                for (const p of list) {
                    const img = fxImages[p.v + '_lit'], shade = fxImages[p.v + '_shade'];
                    if (p.near) {
                        // out of focus, close to the camera
                        const b = fxBlurred(p.v + '_lit', 3), bs = fxBlurred(p.v + '_shade', 3);
                        fxDrawFlake(g, p, b || img, bs || shade, p.size * (b ? b.fxPad : 1), 0.55 * fade, cfg.shade);
                    } else {
                        fxDrawFlake(g, p, img, shade, p.size, (0.5 + 0.5 * Math.min(1, p.d)) * fade, cfg.shade);
                    }
                }
            },
        };
    }

    const FX_EFFECTS = {
        sakura: () => fxFlutterField({
            base: 52, variants: ['petalA', 'petalA', 'petalB', 'petalC'], size: [20, 30], nearShare: 0.06,
            wind: 26, sway: 34, fall: 68, flutter: 1.2, spin: 1.5, shade: 0.7, seed: 0.4,
        }),
        leaves: () => fxFlutterField({
            base: 34, variants: ['mapleRed', 'mapleOrange', 'mapleOrange', 'leafGold', 'leafAmber', 'leafOlive', 'leafBrown'],
            size: [30, 46], nearShare: 0.05, wind: 22, sway: 40, fall: 80, flutter: 1.4, spin: 1.5, shade: 0.45, seed: 1.7,
        }),

        snow: () => {
            // far/mid soft flakes, tumbling crystals, and a few big out-of-focus ones up close
            const S = fxSize();
            const dots = [], crystals = [], bokeh = [];
            const spawnDot = (initial) => {
                const d = fxRand(0.35, 1.1);
                return { d, x: fxRand(-20, W + 20), y: initial ? fxRand(-10, H) : fxRand(-30, -6), r: fxRand(4, 8.5) * d * S, ph: fxRand(0, 6.3), sw: fxRand(0.6, 1.4) };
            };
            const spawnCrystal = (initial) => {
                const d = fxRand(0.6, 1.1);
                const p = fxNewFlake({ d, size: fxRand(22, 34) * d * S }, 1.2);
                p.x = fxRand(-20, W + 20); p.y = initial ? fxRand(-20, H) : -30;
                return p;
            };
            const spawnBokeh = (initial) => ({ d: fxRand(1.3, 1.7), x: fxRand(0, W), y: initial ? fxRand(0, H) : -60, r: fxRand(18, 34) * S, ph: fxRand(0, 6.3) });
            return {
                frame(g, dt, t) {
                    fxSync(dots, fxCount(110), spawnDot);
                    fxSync(crystals, fxCount(16), spawnCrystal);
                    fxSync(bokeh, Math.round(fxCount(4)), spawnBokeh);
                    const wind = 16 * fxWind(t, 2.2), fade = fxFade();
                    const glow = fxImages.glowCool;
                    dots.sort((a, b) => a.d - b.d);
                    const drawDots = (from, to) => {
                        for (const p of dots) {
                            if (p.d < from || p.d >= to) continue;
                            fxDraw(g, glow, p.x, p.y, p.r * 2, p.r * 2, 0, (0.45 + 0.55 * Math.min(1, p.d)) * fade);
                        }
                    };
                    for (let i = 0; i < dots.length; i++) {
                        const p = dots[i];
                        p.y += (18 + 42 * p.d) * dt;
                        p.x += (wind * p.d + Math.sin(t * p.sw + p.ph) * 11 * p.d) * dt;
                        if (p.y > H + 10 || p.x > W + 30 || p.x < -30) dots[i] = spawnDot(false);
                    }
                    drawDots(0, 0.75);
                    for (let i = 0; i < crystals.length; i++) {
                        const p = crystals[i];
                        fxFlakeStep(p, dt, wind * p.d, 48 * p.d, 0.4);
                        if (p.y > H + 30 || p.x > W + 40 || p.x < -60) crystals[i] = spawnCrystal(false);
                    }
                    const sparkle = fxSparkle();
                    for (const p of crystals) {
                        fxDrawFlake(g, p, fxImages.snowflake_lit, fxImages.snowflake_shade, p.size, 0.95 * fade, 0.6);
                        // a crystal turned to the light flashes
                        const l = fxFlakeLight(p.R);
                        if (l > 0.82) fxDraw(g, sparkle, p.x - p.size * 0.15, p.y - p.size * 0.15, p.size * 1.3, p.size * 1.3, 0, (l - 0.82) * 5 * fade);
                    }
                    drawDots(0.75, 9);
                    const soft = fxBlurred('glowCool', 4);
                    for (let i = 0; i < bokeh.length; i++) {
                        const p = bokeh[i];
                        p.y += 70 * dt;
                        p.x += (wind * 1.6 + Math.sin(t * 0.8 + p.ph) * 14) * dt;
                        if (p.y > H + 60 || p.x > W + 60) bokeh[i] = spawnBokeh(false);
                        const s = p.r * 2 * (soft ? soft.fxPad : 1);
                        fxDraw(g, soft || glow, p.x, p.y, s, s, 0, 0.22 * fade);
                    }
                },
            };
        },

        rain: () => {
            const S = fxSize();
            const drops = [], splashes = [];
            const spawnDrop = (initial) => {
                const d = fxRand(0.4, 1.3);
                return {
                    d, x: fxRand(-W * 0.2, W * 1.05), y: initial ? fxRand(-H * 0.2, H) : fxRand(-160, -20),
                    len: (18 + 52 * d) * S, speed: (850 + 950 * d) * S,
                    // near and mid drops land somewhere on the ground (the lower part of the view)
                    land: d > 0.75 ? H * fxRand(0.62, 1.02) : H + 200,
                };
            };
            return {
                frame(g, dt, t) {
                    fxSync(drops, fxCount(150), spawnDrop);
                    const fade = fxFade();
                    const slant = 0.2 + 0.08 * Math.sin(t * 0.23) + 0.1 * Math.pow(Math.max(0, Math.sin(t * 0.11)), 6);
                    const dl = Math.hypot(slant, 1), dx = slant / dl, dy = 1 / dl;
                    // overcast sky and a little spray mist low down
                    const sky = g.createLinearGradient(0, 0, 0, H * 0.6);
                    sky.addColorStop(0, `rgba(30,42,64,${0.22 * fade})`);
                    sky.addColorStop(1, 'rgba(30,42,64,0)');
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    g.globalAlpha = 1;
                    g.fillStyle = sky;
                    g.fillRect(0, 0, W, H * 0.6);
                    const mist = g.createLinearGradient(0, H, 0, H * 0.72);
                    mist.addColorStop(0, `rgba(205,220,240,${0.13 * fade})`);
                    mist.addColorStop(1, 'rgba(205,220,240,0)');
                    g.fillStyle = mist;
                    g.fillRect(0, H * 0.72, W, H * 0.28);

                    const streak = fxStreak();
                    for (let i = 0; i < drops.length; i++) {
                        const p = drops[i];
                        p.x += dx * p.speed * dt;
                        p.y += dy * p.speed * dt;
                        if (p.y >= p.land) {
                            if (splashes.length < 90) splashes.push({ x: p.x, y: p.land, d: p.d, age: 0, drops: [0, 1, 2].slice(0, 1 + Math.floor(Math.random() * 3)).map(() => ({ vx: fxRand(-70, 70) * p.d, vy: fxRand(-150, -70) * p.d })) });
                            drops[i] = spawnDrop(false);
                            continue;
                        }
                        if (p.y > H + p.len) { drops[i] = spawnDrop(false); continue; }
                        const w = (1.2 + 1.6 * p.d) * S;
                        const a = Math.min(0.85, 0.22 + 0.4 * p.d) * fade;
                        g.globalAlpha = a > 1 ? 1 : a;
                        const kx = w / streak.width, ky = p.len / streak.height;
                        g.setTransform(dy * kx * fxDpr, -dx * kx * fxDpr, dx * ky * fxDpr, dy * ky * fxDpr, p.x * fxDpr, p.y * fxDpr);
                        g.drawImage(streak, -streak.width / 2, -streak.height);
                    }
                    // splashes: a flat ring that spreads and one to three droplets hopping off
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    g.strokeStyle = 'rgb(220,236,255)';
                    g.fillStyle = 'rgb(230,242,255)';
                    for (let i = splashes.length - 1; i >= 0; i--) {
                        const s = splashes[i];
                        s.age += dt;
                        const u = s.age / 0.42;
                        if (u >= 1) { splashes.splice(i, 1); continue; }
                        const rx = (3 + 15 * Math.sqrt(u)) * s.d * S;
                        g.globalAlpha = (1 - u) * 0.55 * fade;
                        g.lineWidth = 1.2 * s.d * S;
                        g.beginPath();
                        g.ellipse(s.x, s.y, rx, rx * 0.26, 0, 0, Math.PI * 2);
                        g.stroke();
                        for (const q of s.drops) {
                            const x = s.x + q.vx * s.age, y = s.y + q.vy * s.age + 700 * s.age * s.age;
                            if (y > s.y + 2) continue;
                            g.beginPath();
                            g.arc(x, y, 1.3 * s.d * S, 0, Math.PI * 2);
                            g.fill();
                        }
                    }
                },
            };
        },

        fog: () => {
            // long, soft banks of mist lying low and drifting sideways; near banks pass faster
            const banks = [];
            const S = fxSize();
            const spawn = (initial) => {
                const layer = Math.floor(Math.random() * 3);
                const w = fxRand(700, 1300) * (0.7 + layer * 0.25) * S;
                return {
                    layer, w, h: w * fxRand(0.26, 0.36), v: fxPick(['puffA', 'puffB', 'puffC']),
                    x: initial ? fxRand(-w * 0.2, W + w * 0.2) : -w * 0.55,
                    y: H * (0.42 + layer * 0.17 + fxRand(-0.08, 0.1)),
                    vx: fxRand(6, 12) * (0.6 + layer * 0.45) * S, ph: fxRand(0, 6.3), rot: fxRand(-0.05, 0.05), flip: Math.random() < 0.5,
                    a: fxRand(0.09, 0.16) * (0.75 + layer * 0.2),
                };
            };
            return {
                lowRes: true,
                frame(g, dt, t) {
                    fxSync(banks, Math.round(22 * Math.max(fxVolume, 0.3)), spawn);
                    const k = Math.min(1.8, 0.4 + 0.8 * Math.max(1, fxOpacity));
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    g.globalAlpha = 1;
                    g.fillStyle = `rgba(212,222,236,${Math.min(0.12, 0.05 * k)})`;
                    g.fillRect(0, 0, W, H);
                    const haze = g.createLinearGradient(0, H, 0, H * 0.45);
                    haze.addColorStop(0, `rgba(220,228,240,${Math.min(0.5, 0.28 * k)})`);
                    haze.addColorStop(1, 'rgba(220,228,240,0)');
                    g.fillStyle = haze;
                    g.fillRect(0, H * 0.45, W, H * 0.55);
                    banks.sort((a, b) => a.layer - b.layer);
                    for (let i = 0; i < banks.length; i++) {
                        const p = banks[i];
                        p.x += p.vx * dt;
                        if (p.x > W + p.w * 0.6) { banks[i] = spawn(false); continue; }
                        const img = fxBlurred(p.v, 7);
                        if (!img) continue;
                        const y = p.y + Math.sin(t * 0.15 + p.ph) * 10 * S;
                        const w = p.w * img.fxPad, h = p.h * img.fxPad;
                        fxDraw(g, img, p.x, y, p.flip ? -w : w, h, p.rot, Math.min(0.6, p.a * k));
                    }
                },
            };
        },

        steam: () => {
            // hot steam billowing up from below: white cel-shaded puffs that swell and thin out as
            // they rise, and a few curling wisps between them
            const puffs = [], wisps = [];
            const S = fxSize();
            const spawnPuff = (initial) => {
                const life = fxRand(6, 10);
                return {
                    v: fxPick(['puffA', 'puffB', 'puffC']), life, age: initial ? fxRand(0, life * 0.9) : 0,
                    x0: fxRand(-60, W + 60), s0: fxRand(130, 220) * S, vy: -fxRand(50, 85) * S, ph: fxRand(0, 6.3),
                    rot: fxRand(-0.5, 0.5), vr: fxRand(-0.15, 0.15), a: fxRand(0.55, 0.8), flip: Math.random() < 0.5,
                };
            };
            const spawnWisp = (initial) => ({ x: fxRand(W * 0.05, W * 0.95), age: initial ? fxRand(0, 4) : 0, life: fxRand(4, 6), len: fxRand(140, 260) * S, amp: fxRand(10, 20) * S, ph: fxRand(0, 6.3), w: fxRand(5, 9) * S });
            return {
                frame(g, dt, t) {
                    fxSync(puffs, fxCount(32), spawnPuff);
                    fxSync(wisps, Math.max(0, Math.round(6 * fxVolume)), spawnWisp);
                    const fade = fxFade();
                    for (let i = 0; i < puffs.length; i++) {
                        const p = puffs[i];
                        p.age += dt;
                        if (p.age >= p.life) { puffs[i] = spawnPuff(false); continue; }
                        const u = p.age / p.life;
                        const size = p.s0 * (0.6 + 1.8 * u);
                        const x = p.x0 + Math.sin(p.age * 0.7 + p.ph) * 26 * S * (0.3 + u);
                        const y = H + p.s0 * 0.7 + p.vy * p.age;
                        const a = p.a * fxSmooth(0, 0.12, u) * Math.pow(1 - u, 1.3) * fade;
                        const r = p.rot + p.vr * p.age;
                        const m = p.flip ? -1 : 1;
                        // crisp and cel-shaded while young, dissolving as it swells
                        if (u < 0.45) fxDraw(g, fxImages[p.v], x, y, size * m, size, r, a * (1 - u / 0.45) * 0.35);
                        const soft = fxBlurred(p.v, 6);
                        if (soft) fxDraw(g, soft, x, y, size * soft.fxPad * m, size * soft.fxPad, r, a * Math.min(1, 0.65 + u));
                    }
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    g.lineCap = 'round';
                    g.lineJoin = 'round';
                    g.strokeStyle = 'rgb(250,251,255)';
                    // blurred and faint, so the wisps melt into the clouds instead of reading as lines
                    const blur = typeof g.filter === 'string';
                    if (blur) g.filter = `blur(${(3 * S * fxDpr).toFixed(1)}px)`;
                    for (let i = 0; i < wisps.length; i++) {
                        const w = wisps[i];
                        w.age += dt;
                        if (w.age >= w.life) { wisps[i] = spawnWisp(false); continue; }
                        const u = w.age / w.life;
                        const base = H * (1.02 - 0.55 * u);
                        const env = Math.sin(Math.PI * u) * fade;
                        g.beginPath();
                        for (let k = 0; k <= 16; k++) {
                            const f = k / 16;
                            const y = base - f * w.len;
                            const x = w.x + Math.sin(f * 5 + w.ph + t * 1.3) * w.amp * (0.3 + f * 1.2);
                            if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
                        }
                        // a wide faint body and a brighter core
                        g.globalAlpha = 0.08 * env;
                        g.lineWidth = w.w * (2 - 0.8 * u);
                        g.stroke();
                        g.globalAlpha = 0.14 * env;
                        g.lineWidth = w.w * 0.55 * (1.2 - 0.6 * u);
                        g.stroke();
                    }
                    if (blur) g.filter = 'none';
                },
            };
        },

        darkness: () => {
            // the scene sinks into shadow: dark smoke creeping in from the edges, a heavy vignette
            // and faint violet motes drifting up
            const miasma = [], motes = [];
            const S = fxSize();
            const spawnMiasma = () => {
                const side = Math.floor(Math.random() * 4), along = Math.random(), off = fxRand(-0.08, 0.06);
                const pos = [[off * W, along * H], [W - off * W, along * H], [along * W, H - off * H], [along * W, off * H]][side];
                const drift = fxRand(4, 10) * (Math.random() < 0.5 ? 1 : -1);
                return {
                    x: pos[0], y: pos[1], s: fxRand(380, 700) * S, v: Math.random() < 0.5 ? 'darkA' : 'darkB', ph: fxRand(0, 6.3), sp: fxRand(0.25, 0.6),
                    rot: fxRand(0, 6.3), vr: fxRand(-0.05, 0.05), vx: side < 2 ? 0 : drift, vy: side < 2 ? drift : 0, a: fxRand(0.55, 0.85), flip: Math.random() < 0.5,
                };
            };
            const spawnMote = (initial) => ({ x: fxRand(0, W), y: initial ? fxRand(0, H) : H + 20, d: fxRand(0.5, 1.2), vy: -fxRand(10, 28), ph: fxRand(0, 6.3), fl: fxRand(1.5, 4) });
            let vignette = null, vw = 0, vh = 0;
            return {
                lowRes: true,
                frame(g, dt, t) {
                    fxSync(miasma, fxCount(14), spawnMiasma);
                    fxSync(motes, fxCount(30), spawnMote);
                    const k = Math.min(1.6, 0.35 + 0.65 * Math.max(1, fxOpacity));
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    g.globalAlpha = 1;
                    g.fillStyle = `rgba(6,2,14,${Math.min(0.45, 0.24 * k)})`;
                    g.fillRect(0, 0, W, H);
                    for (let i = 0; i < miasma.length; i++) {
                        const p = miasma[i];
                        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
                        if (p.x < -p.s || p.x > W + p.s || p.y < -p.s || p.y > H + p.s) { miasma[i] = spawnMiasma(); continue; }
                        const pulse = 0.75 + 0.25 * Math.sin(t * p.sp + p.ph);
                        const img = fxBlurred(p.v, 5);
                        if (!img) continue;
                        const s = p.s * (0.92 + 0.12 * pulse) * img.fxPad;
                        fxDraw(g, img, p.x, p.y, p.flip ? -s : s, s, p.rot, Math.min(0.95, p.a * pulse * k));
                    }
                    if (!vignette || vw !== W || vh !== H) {
                        vw = W; vh = H;
                        vignette = fxCanvas(Math.max(1, Math.round(W / 4)), Math.max(1, Math.round(H / 4)));
                        const vg = vignette.getContext('2d');
                        const grad = vg.createRadialGradient(W / 8, H / 8, Math.min(W, H) / 20, W / 8, H / 8, Math.hypot(W, H) / 8);
                        grad.addColorStop(0, 'rgba(4,0,10,0)');
                        grad.addColorStop(0.5, 'rgba(4,0,10,0.4)');
                        grad.addColorStop(1, 'rgba(2,0,6,1)');
                        vg.fillStyle = grad;
                        vg.fillRect(0, 0, vignette.width, vignette.height);
                    }
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    g.globalAlpha = Math.min(1, 0.75 * k);
                    g.drawImage(vignette, 0, 0, W, H);
                    const glow = fxImages.glowViolet;
                    for (let i = 0; i < motes.length; i++) {
                        const p = motes[i];
                        p.y += p.vy * p.d * dt;
                        p.x += Math.sin(t * 0.7 + p.ph) * 9 * p.d * dt;
                        if (p.y < -20) { motes[i] = spawnMote(false); continue; }
                        const f = 0.55 + 0.45 * Math.sin(t * p.fl + p.ph);
                        const s = (16 + 12 * p.d) * S;
                        fxDraw(g, glow, p.x, p.y, s, s, 0, f * 0.75 * Math.min(1, k));
                    }
                },
            };
        },

        aurora: () => {
            // curtains of light with rays that ripple along them, and twinkling stars
            const S = fxSize();
            const stars = [];
            const spawnStar = () => ({ x: fxRand(0, W), y: Math.pow(Math.random(), 1.4) * H * 0.6, r: fxRand(0.8, 2.2) * S, ph: fxRand(0, 6.3), sp: fxRand(0.8, 2.6), big: Math.random() < 0.12 });
            const ribbons = [0, 1, 2, 3, 4].map(i => ({
                y: fxRand(0.14, 0.3) + i * 0.035, h: fxRand(0.16, 0.28), a1: fxRand(0.03, 0.06), f1: fxRand(1.2, 2.4), s1: fxRand(0.05, 0.12) * (Math.random() < 0.5 ? 1 : -1),
                a2: fxRand(0.01, 0.025), f2: fxRand(4, 7), s2: fxRand(0.15, 0.3), ph: fxRand(0, 6.3), c: fxRand(0.25, 0.75), span: fxRand(0.35, 0.6), drift: fxRand(0.01, 0.025),
                pal: i % 2 ? 'auroraB' : 'auroraA', ray: fxRand(0, 6.3),
            }));
            const pals = {
                auroraA: [[0, 'rgba(150,90,255,0)'], [0.35, 'rgba(150,90,255,0.22)'], [0.68, 'rgba(50,225,190,0.55)'], [0.9, 'rgba(120,255,170,0.95)'], [0.97, 'rgba(210,255,225,1)'], [1, 'rgba(210,255,225,0)']],
                auroraB: [[0, 'rgba(255,90,200,0)'], [0.3, 'rgba(255,100,210,0.2)'], [0.62, 'rgba(120,110,255,0.45)'], [0.88, 'rgba(70,235,210,0.9)'], [0.97, 'rgba(200,255,240,1)'], [1, 'rgba(200,255,240,0)']],
            };
            return {
                blend: 'screen',
                frame(g, dt, t) {
                    fxSync(stars, fxCount(70), spawnStar);
                    const fade = fxFade();
                    const sparkle = fxSparkle(), dot = fxImages.glowCool;
                    for (const s of stars) {
                        const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
                        fxDraw(g, dot, s.x, s.y, s.r * 3, s.r * 3, 0, (0.35 + 0.65 * tw) * fade);
                        if (s.big && tw > 0.7) fxDraw(g, sparkle, s.x, s.y, s.r * 9, s.r * 9, 0, (tw - 0.7) * 2.4 * fade);
                    }
                    g.globalCompositeOperation = 'lighter';
                    const count = Math.max(1, Math.min(5, Math.round(3 * fxVolume)));
                    const step = Math.max(5, W / 240);
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    for (let r = 0; r < count; r++) {
                        const b = ribbons[r];
                        const strip = fxAuroraStrip(b.pal, pals[b.pal]);
                        const cx = W * (b.c + Math.sin(t * b.drift + b.ph) * 0.18), half = W * b.span;
                        for (let x = cx - half; x <= cx + half; x += step) {
                            const env = fxSmooth(half, half * 0.35, Math.abs(x - cx));
                            if (env <= 0.01) continue;
                            // waves keep their shape on narrow (phone) screens
                            const u = x / Math.max(W, 1000);
                            const yb = H * (b.y + Math.sin(u * b.f1 * 6.283 + t * b.s1 * 6.283 + b.ph) * b.a1 + Math.sin(u * b.f2 * 6.283 - t * b.s2 * 6.283) * b.a2);
                            const ray = (0.5 + 0.5 * Math.sin(x * 0.045 + t * 0.9 + b.ray)) * (0.55 + 0.45 * Math.sin(x * 0.012 - t * 0.35 + b.ray * 2));
                            const h = H * b.h * (0.65 + 0.5 * ray);
                            g.globalAlpha = Math.min(1, (0.18 + 0.5 * ray) * env * 0.56 * fade);
                            g.drawImage(strip, x - step * 1.25, yb - h, step * 2.5, h);
                        }
                    }
                    g.globalCompositeOperation = 'source-over';
                },
            };
        },

        sparks: () => {
            // embers rising from a fire below: white-hot, then orange, then dull red; now and then
            // the fire crackles and throws a handful of quick sparks
            const S = fxSize();
            const embers = [], pops = [], bokeh = [];
            const spawnEmber = (initial) => {
                const life = fxRand(2.4, 5.5);
                return { x: fxRand(-20, W + 20), y: initial ? fxRand(H * 0.2, H + 10) : H + fxRand(5, 30), vx: 0, vy: -fxRand(40, 90), d: fxRand(0.5, 1.2), life, age: initial ? fxRand(0, life * 0.8) : 0, s: fxRand(11, 20), ph: fxRand(0, 6.3), wob: fxRand(0.8, 2.2) };
            };
            const spawnBokeh = (initial) => ({ x: fxRand(0, W), y: initial ? fxRand(0, H) : H + 40, r: fxRand(16, 30) * S, vy: -fxRand(22, 40), ph: fxRand(0, 6.3) });
            let nextPop = fxRand(0.8, 2.5);
            return {
                blend: 'screen',
                frame(g, dt, t) {
                    fxSync(embers, fxCount(120), spawnEmber);
                    fxSync(bokeh, Math.round(fxCount(4)), spawnBokeh);
                    const fade = fxFade(), wind = 14 * (fxWind(t, 3.1) - 0.8);
                    const flick = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.1);
                    const base = g.createLinearGradient(0, H, 0, H - 240 * S);
                    base.addColorStop(0, `rgba(255,70,10,${Math.min(0.5, 0.3 * fade * flick)})`);
                    base.addColorStop(0.45, `rgba(255,130,30,${Math.min(0.2, 0.1 * fade * flick)})`);
                    base.addColorStop(1, 'rgba(255,90,20,0)');
                    g.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
                    g.globalAlpha = 1;
                    g.fillStyle = base;
                    g.fillRect(0, H - 240 * S, W, 240 * S);
                    g.globalCompositeOperation = 'lighter';
                    const hot = fxImages.glowEmberHot, mid = fxImages.glowEmber, cool = fxImages.glowEmberCool;
                    const kd = 1 - Math.exp(-2.5 * dt);
                    for (let i = 0; i < embers.length; i++) {
                        const p = embers[i];
                        p.age += dt;
                        if (p.age >= p.life || p.y < -30) { embers[i] = spawnEmber(false); continue; }
                        const u = p.age / p.life;
                        p.vx += (wind + Math.sin(t * p.wob + p.ph) * 38 * p.d - p.vx) * kd;
                        p.vy += (-(55 + 85 * p.d) * S - p.vy) * kd;
                        p.x += p.vx * dt;
                        p.y += p.vy * dt;
                        const size = p.s * p.d * S * (1 - 0.55 * u);
                        const a = fxSmooth(0, 0.08, u) * (1 - fxSmooth(0.6, 1, u)) * (0.75 + 0.25 * Math.sin(t * 17 + p.ph * 7)) * fade;
                        const long = Math.hypot(p.vx, p.vy) * 0.05;
                        // white-hot → orange → red, cross-faded
                        if (u < 0.35) {
                            const f = u / 0.35;
                            fxDrawStreak(g, hot, p.x, p.y, size, p.vx, p.vy, long, a * (1 - f));
                            fxDrawStreak(g, mid, p.x, p.y, size, p.vx, p.vy, long, a * f);
                        } else {
                            const f = Math.min(1, (u - 0.35) / 0.4);
                            fxDrawStreak(g, mid, p.x, p.y, size, p.vx, p.vy, long, a * (1 - f));
                            fxDrawStreak(g, cool, p.x, p.y, size, p.vx, p.vy, long, a * f);
                        }
                    }
                    nextPop -= dt;
                    if (nextPop <= 0 && pops.length < 60) {
                        nextPop = fxRand(1.2, 3.5) / Math.max(0.4, fxVolume);
                        const x = fxRand(W * 0.08, W * 0.92), y = H - fxRand(0, 60) * S;
                        for (let n = 0, m = 6 + Math.floor(Math.random() * 7); n < m; n++) {
                            const ang = -Math.PI / 2 + fxRand(-0.75, 0.75), sp = fxRand(220, 460) * S;
                            pops.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0, life: fxRand(0.45, 0.9) });
                        }
                    }
                    for (let i = pops.length - 1; i >= 0; i--) {
                        const p = pops[i];
                        p.age += dt;
                        if (p.age >= p.life) { pops.splice(i, 1); continue; }
                        p.vy += 520 * S * dt;
                        p.vx *= Math.exp(-1.2 * dt);
                        p.x += p.vx * dt;
                        p.y += p.vy * dt;
                        const u = p.age / p.life;
                        fxDrawStreak(g, u < 0.5 ? hot : mid, p.x, p.y, 8 * S, p.vx, p.vy, Math.hypot(p.vx, p.vy) * 0.045, (1 - u) * fade);
                    }
                    const soft = fxBlurred('glowEmber', 4);
                    for (let i = 0; i < bokeh.length; i++) {
                        const p = bokeh[i];
                        p.y += p.vy * dt;
                        p.x += Math.sin(t * 0.6 + p.ph) * 12 * dt;
                        if (p.y < -60) { bokeh[i] = spawnBokeh(false); continue; }
                        const s = p.r * 2 * (soft ? soft.fxPad : 1);
                        fxDraw(g, soft || mid, p.x, p.y, s, s, 0, 0.45 * fxSmooth(-60, H * 0.3, p.y) * fade);
                    }
                    g.globalCompositeOperation = 'source-over';
                },
            };
        },

        fireflies: () => {
            // they wander near the ground, dim most of the time, and flash in slow pulses
            const S = fxSize();
            const flies = [], bokeh = [];
            const spawn = () => ({
                x: fxRand(0, W), y: H * (0.25 + 0.75 * Math.sqrt(Math.random())), d: fxRand(0.5, 1.15), head: fxRand(0, 6.3),
                sp: fxRand(12, 30), ph: fxRand(0, 6.3), flash: fxRand(0, 3), dur: fxRand(0.9, 1.7), gap: fxRand(1.5, 4.5), s: fxRand(32, 46),
            });
            const spawnBokeh = () => ({ x: fxRand(0, W), y: fxRand(H * 0.3, H), r: fxRand(22, 40) * S, ph: fxRand(0, 6.3), sp: fxRand(0.3, 0.7) });
            return {
                blend: 'screen',
                frame(g, dt, t) {
                    fxSync(flies, fxCount(50), spawn);
                    fxSync(bokeh, Math.round(fxCount(3)), spawnBokeh);
                    const fade = fxFade(), img = fxImages.glowFirefly, sparkle = fxSparkle();
                    g.globalCompositeOperation = 'lighter';
                    for (const p of flies) {
                        p.head += (Math.sin(t * 0.6 + p.ph) * 0.9 + fxRand(-0.8, 0.8)) * dt;
                        // steer back when leaving the area
                        const tx = p.x < W * 0.03 ? 1 : p.x > W * 0.97 ? -1 : 0, ty = p.y < H * 0.2 ? 1 : p.y > H * 0.98 ? -1 : 0;
                        if (tx || ty) {
                            const want = Math.atan2(ty, tx);
                            p.head += Math.atan2(Math.sin(want - p.head), Math.cos(want - p.head)) * Math.min(1, 2 * dt);
                        }
                        p.x += Math.cos(p.head) * p.sp * p.d * S * dt;
                        p.y += (Math.sin(p.head) * 0.6 * p.sp + Math.sin(t * 1.3 + p.ph) * 6) * p.d * S * dt;
                        p.flash -= dt;
                        if (p.flash < -p.dur) { p.flash = p.gap; p.gap = fxRand(1.5, 4.5); }
                        const e = p.flash < 0 ? Math.pow(Math.sin(Math.PI * (-p.flash / p.dur)), 1.5) : 0;
                        const size = p.s * p.d * S * (0.62 + 0.5 * e);
                        fxDraw(g, img, p.x, p.y, size, size, 0, (0.07 + 0.93 * e) * fade);
                        if (e > 0.8 && p.d > 0.95) fxDraw(g, sparkle, p.x, p.y, size * 0.9, size * 0.9, 0.4, (e - 0.8) * 2.5 * fade);
                    }
                    const soft = fxBlurred('glowFirefly', 4);
                    for (const p of bokeh) {
                        p.x += Math.sin(t * 0.2 + p.ph) * 8 * dt;
                        p.y += Math.cos(t * 0.17 + p.ph) * 6 * dt;
                        const s = p.r * 2 * (soft ? soft.fxPad : 1);
                        fxDraw(g, soft || img, p.x, p.y, s, s, 0, (0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * p.sp + p.ph))) * fade);
                    }
                    g.globalCompositeOperation = 'source-over';
                },
            };
        },
    };

    if (particleBtn) {
        particleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const character = characters[currentCharacterId];
            if (particlePickerModal) {
                const currentEffect = getEffectiveParticleEffect(character, character?.chats?.[currentChatId]);
                particlePickerModal.querySelectorAll('.particle-option-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.effect === currentEffect);
                });
                fxApplyLevels(fxSavedLevels(character));
                if (particleSettingsRow) particleSettingsRow.classList.toggle('hidden', currentEffect === 'none');
                particlePickerModal.classList.remove('hidden');
            }
        });
    }
    if (closeParticlePickerBtn) closeParticlePickerBtn.addEventListener('click', () => { if (particlePickerModal) particlePickerModal.classList.add('hidden'); });
    for (const [name, key] of Object.entries(FX_SETTING_KEYS)) {
        const slider = document.getElementById(`particle-${name}-slider`);
        if (!slider) continue;
        // The level applies on every step of a drag; the character (images and
        // all) is written once it settles, or at once on release.
        let pendingSave = null;
        const saveLevel = (character) => {
            clearTimeout(pendingSave);
            pendingSave = null;
            saveSingleCharacterToDB(character).catch(err => console.error('Could not save the effect level:', err));
        };
        slider.addEventListener('input', () => {
            fxApplyLevels({ [name]: parseInt(slider.value, 10) });
            const character = characters[currentCharacterId];
            if (character) {
                character[key] = fxLevels[name];
                clearTimeout(pendingSave);
                pendingSave = setTimeout(() => saveLevel(character), 300);
            }
        });
        slider.addEventListener('change', () => {
            const character = characters[currentCharacterId];
            if (character && pendingSave) saveLevel(character);
        });
    }
    if (particlePickerModal) {
        particlePickerModal.addEventListener('click', async (e) => {
            if (e.target === particlePickerModal) { particlePickerModal.classList.add('hidden'); return; }
            const btn = e.target.closest('.particle-option-btn');
            if (!btn) return;
            const effect = btn.dataset.effect;
            const character = characters[currentCharacterId];
            if (!character) return;
            character.particleEffect = effect;
            // A hand-picked effect replaces whatever the automatic atmosphere
            // chose for this chat, until the next reply picks again.
            const openChat = character.chats?.[currentChatId];
            if (openChat) delete openChat.sceneEffect;
            particlePickerModal.querySelectorAll('.particle-option-btn').forEach(b => b.classList.toggle('active', b.dataset.effect === effect));
            if (particleSettingsRow) particleSettingsRow.classList.toggle('hidden', effect === 'none');
            await saveSingleCharacterToDB(character);
            startParticles(effect);
            updateParticleButton();
        });
    }

    // ── Feature B: Background Music ──
    // The 🎵 panel is a small music player. A chat's music is a playlist: the
    // character's Music URL field (one URL per line), or the list built in the
    // panel, which is kept per character in local storage and wins over the
    // character's. A track is a YouTube video, played in a hidden embed that is
    // driven through the embed's postMessage API, or a direct audio file.
    const musicBtn = document.getElementById('music-btn');
    const musicPanel = document.getElementById('music-panel');
    const musicUrlInput = document.getElementById('music-url-input');
    const musicAddBtn = document.getElementById('music-add-btn');
    const musicPlayBtn = document.getElementById('music-play-btn');
    const musicStopBtn = document.getElementById('music-stop-btn');
    const musicPrevBtn = document.getElementById('music-prev-btn');
    const musicNextBtn = document.getElementById('music-next-btn');
    const musicShuffleBtn = document.getElementById('music-shuffle-btn');
    const musicRepeatBtn = document.getElementById('music-repeat-btn');
    const musicSeek = document.getElementById('music-seek');
    const musicTimeCurrent = document.getElementById('music-time-current');
    const musicTimeTotal = document.getElementById('music-time-total');
    const musicVolumeSlider = document.getElementById('music-volume');
    const musicMuteBtn = document.getElementById('music-mute-btn');
    const musicPlaylistEl = document.getElementById('music-playlist');
    const musicResetBtn = document.getElementById('music-reset-btn');
    const musicNowTitle = document.getElementById('music-now-title');
    const musicNowSub = document.getElementById('music-now-sub');

    const MUSIC_REPEAT_MODES = {
        all: { icon: '🔁', label: 'Repeat: whole playlist' },
        one: { icon: '🔂', label: 'Repeat: this track' },
        off: { icon: '🔁', label: 'Repeat: off' }
    };
    const MUSIC_TITLES_KEY = 'cccMusicTitles';
    const MUSIC_TITLES_MAX = 300;
    const MUSIC_YT_ID = 'ccc-music';

    let musicPlaylist = [];         // track URLs, in playlist order
    let musicOrder = [];            // playlist indices in play order (shuffled or not)
    let musicIndex = -1;            // the selected track; loaded only while a player exists
    let musicAudioEl = null;
    let musicIframeEl = null;
    let musicIsPlaying = false;
    let musicStatus = '';           // an error to show in place of the track position
    let musicFailures = 0;          // tracks in a row that would not play
    let musicSeeking = false;       // the timeline is being dragged
    let musicYt = { ready: false, time: 0, duration: 0, state: null };
    let musicCurrentCharId = null;
    let musicCurrentChatId = null;
    let musicShuffle = localStorage.getItem('cccMusicShuffle') === '1';
    let musicRepeat = MUSIC_REPEAT_MODES[localStorage.getItem('cccMusicRepeat')] ? localStorage.getItem('cccMusicRepeat') : 'all';
    const savedMusicVolume = parseInt(localStorage.getItem('cccMusicVolume'), 10);
    let musicVolume = Number.isFinite(savedMusicVolume) ? Math.min(100, Math.max(0, savedMusicVolume)) : 70;
    let musicVolumeBeforeMute = musicVolume || 70;
    let musicTitles = {};
    try { musicTitles = JSON.parse(localStorage.getItem(MUSIC_TITLES_KEY)) || {}; } catch (e) { musicTitles = {}; }
    const musicTitleRequests = new Set();

    function extractYouTubeId(url) {
        const m = url.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|v\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    function parseMusicList(text) {
        return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    }

    function formatMusicTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
        const s = Math.floor(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = String(s % 60).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    }

    function musicTrackTitle(url) {
        const ytId = extractYouTubeId(url);
        if (ytId) return musicTitles[ytId] || 'YouTube video';
        try {
            const u = new URL(url, location.href);
            const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
            return file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').trim() || u.hostname || url;
        } catch (e) {
            return url;
        }
    }

    function rememberMusicTitle(ytId, title) {
        if (!ytId || !title || musicTitles[ytId] === title) return;
        delete musicTitles[ytId];
        musicTitles[ytId] = title;
        const ids = Object.keys(musicTitles);
        ids.slice(0, Math.max(0, ids.length - MUSIC_TITLES_MAX)).forEach(id => delete musicTitles[id]);
        try { localStorage.setItem(MUSIC_TITLES_KEY, JSON.stringify(musicTitles)); } catch (e) { /* full; the titles are only a nicety */ }
        renderMusicPanel();
    }

    // YouTube's oEmbed answers cross-origin requests, file:// pages included,
    // so a playlist can show real titles before its videos have been played.
    function fetchMusicTitle(url) {
        const ytId = extractYouTubeId(url);
        if (!ytId || musicTitles[ytId] || musicTitleRequests.has(ytId)) return;
        musicTitleRequests.add(ytId);
        fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + ytId)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.title) rememberMusicTitle(ytId, data.title); })
            .catch(() => {});
    }

    function musicHasTrack() {
        return !!(musicAudioEl || musicIframeEl);
    }

    function musicLoopsItself() {
        return musicRepeat === 'one' || (musicRepeat === 'all' && musicPlaylist.length === 1);
    }

    function rebuildMusicOrder() {
        const order = musicPlaylist.map((_, i) => i);
        if (musicShuffle) {
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            // The track that is on stays on: the shuffled order starts from it.
            const at = order.indexOf(musicIndex);
            if (at > 0) order.unshift(...order.splice(at, 1));
        }
        musicOrder = order;
    }

    function saveMusicList() {
        if (!musicCurrentCharId) return;
        localStorage.setItem(`userMusicUrl:${musicCurrentCharId}`, musicPlaylist.join('\n'));
    }

    function characterMusicList(charId) {
        return parseMusicList(characters[charId]?.musicUrl);
    }

    function savedMusicList(charId) {
        const saved = localStorage.getItem(`userMusicUrl:${charId}`);
        return saved !== null ? parseMusicList(saved) : characterMusicList(charId);
    }

    function setMusicPlaying(on) {
        musicIsPlaying = on;
        if (musicPlayBtn) {
            musicPlayBtn.textContent = on ? '⏸' : '▶';
            musicPlayBtn.title = on ? 'Pause' : 'Play';
            musicPlayBtn.setAttribute('aria-label', musicPlayBtn.title);
        }
        musicBtn?.classList.toggle('is-playing', on);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : (musicHasTrack() ? 'paused' : 'none');
        renderMusicNowPlaying();
    }

    function musicTimes() {
        if (musicAudioEl) return { time: musicAudioEl.currentTime || 0, duration: musicAudioEl.duration };
        if (musicIframeEl) return { time: musicYt.time, duration: musicYt.duration };
        return { time: 0, duration: 0 };
    }

    function paintMusicSeek(time, duration) {
        const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
        musicSeek.style.setProperty('--music-progress', `${pct}%`);
        musicTimeCurrent.textContent = formatMusicTime(time);
    }

    function updateMusicTimeline() {
        if (!musicSeek || musicSeeking || musicPanel?.classList.contains('hidden')) return;
        const { time, duration } = musicTimes();
        const seekable = Number.isFinite(duration) && duration > 0;
        musicSeek.disabled = !seekable;
        musicSeek.max = seekable ? String(duration) : '0';
        musicSeek.value = seekable ? String(Math.min(time, duration)) : '0';
        paintMusicSeek(time, seekable ? duration : 0);
        musicTimeTotal.textContent = seekable ? formatMusicTime(duration)
            : (musicAudioEl && duration === Infinity ? 'LIVE' : '0:00');
    }

    function renderMusicNowPlaying() {
        if (!musicNowTitle || !musicNowSub) return;
        const url = musicPlaylist[musicIndex];
        musicNowTitle.textContent = url ? musicTrackTitle(url) : 'Nothing playing';
        musicNowTitle.title = url || '';
        let sub;
        if (musicStatus) sub = musicStatus;
        else if (!musicPlaylist.length) sub = 'Add a track below to start.';
        else if (!url) sub = `${musicPlaylist.length} track${musicPlaylist.length === 1 ? '' : 's'}`;
        else {
            sub = `Track ${musicIndex + 1} of ${musicPlaylist.length}`;
            if (!musicHasTrack()) sub += ' · Stopped';
            else if (!musicIsPlaying) sub += ' · Paused';
        }
        musicNowSub.textContent = sub;
        musicNowSub.classList.toggle('is-error', !!musicStatus);
        musicBtn?.setAttribute('title', url && musicHasTrack() ? `Background Music — ${musicTrackTitle(url)}` : 'Background Music');
        const noTracks = !musicPlaylist.length;
        [musicPlayBtn, musicPrevBtn, musicNextBtn, musicStopBtn].forEach(b => { if (b) b.disabled = noTracks; });
        if ('mediaSession' in navigator && typeof MediaMetadata === 'function') {
            navigator.mediaSession.metadata = url && musicHasTrack() ? new MediaMetadata({ title: musicTrackTitle(url), artist: 'Casual Character Chat' }) : null;
        }
    }

    function renderMusicControls() {
        if (musicShuffleBtn) {
            musicShuffleBtn.classList.toggle('active', musicShuffle);
            musicShuffleBtn.setAttribute('aria-pressed', String(musicShuffle));
            musicShuffleBtn.title = musicShuffle ? 'Shuffle: on' : 'Shuffle: off';
        }
        if (musicRepeatBtn) {
            const mode = MUSIC_REPEAT_MODES[musicRepeat];
            musicRepeatBtn.textContent = mode.icon;
            musicRepeatBtn.title = mode.label;
            musicRepeatBtn.setAttribute('aria-label', mode.label);
            musicRepeatBtn.classList.toggle('active', musicRepeat !== 'off');
        }
        if (musicVolumeSlider) {
            musicVolumeSlider.value = String(musicVolume);
            musicVolumeSlider.style.setProperty('--music-progress', `${musicVolume}%`);
        }
        if (musicMuteBtn) {
            musicMuteBtn.textContent = musicVolume === 0 ? '🔇' : musicVolume < 34 ? '🔈' : musicVolume < 67 ? '🔉' : '🔊';
            musicMuteBtn.title = musicVolume === 0 ? 'Unmute' : 'Mute';
        }
        if (musicResetBtn) {
            const charId = musicCurrentCharId;
            const own = charId ? localStorage.getItem(`userMusicUrl:${charId}`) : null;
            const differs = own !== null && parseMusicList(own).join('\n') !== characterMusicList(charId).join('\n');
            musicResetBtn.classList.toggle('hidden', !differs);
        }
    }

    function renderMusicPlaylist() {
        if (!musicPlaylistEl) return;
        musicPlaylistEl.textContent = '';
        if (!musicPlaylist.length) {
            const empty = document.createElement('li');
            empty.className = 'music-playlist-empty';
            empty.textContent = 'No tracks yet. Paste a YouTube link or a direct audio link (.mp3, .ogg, …) below.';
            musicPlaylistEl.appendChild(empty);
            return;
        }
        musicPlaylist.forEach((url, i) => {
            fetchMusicTitle(url);
            const li = document.createElement('li');
            const isCurrent = i === musicIndex;
            li.className = 'music-track' + (isCurrent ? ' current' : '') + (isCurrent && musicIsPlaying ? ' playing' : '');

            const main = document.createElement('button');
            main.type = 'button';
            main.className = 'music-track-main';
            main.title = url;
            main.dataset.action = 'play';
            main.dataset.index = String(i);
            const num = document.createElement('span');
            num.className = 'music-track-num';
            num.textContent = isCurrent && musicHasTrack() ? (musicIsPlaying ? '♪' : '⏸') : String(i + 1);
            const name = document.createElement('span');
            name.className = 'music-track-title';
            name.textContent = musicTrackTitle(url);
            main.append(num, name);
            li.appendChild(main);

            [['up', '↑', 'Move up', i === 0],
             ['down', '↓', 'Move down', i === musicPlaylist.length - 1],
             ['remove', '✕', 'Remove from playlist', false]].forEach(([action, text, label, disabled]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `music-track-btn music-track-${action}`;
                b.textContent = text;
                b.title = label;
                b.setAttribute('aria-label', label);
                b.dataset.action = action;
                b.dataset.index = String(i);
                b.disabled = disabled;
                li.appendChild(b);
            });
            musicPlaylistEl.appendChild(li);
        });
    }

    function renderMusicPanel() {
        renderMusicNowPlaying();
        renderMusicControls();
        if (!musicPanel?.classList.contains('hidden')) {
            renderMusicPlaylist();
            updateMusicTimeline();
        }
    }

    function teardownMusicPlayer() {
        if (musicAudioEl) {
            const audio = musicAudioEl;
            musicAudioEl = null;
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            audio.remove();
        }
        if (musicIframeEl) {
            const iframe = musicIframeEl;
            musicIframeEl = null;
            iframe.src = 'about:blank';
            iframe.remove();
        }
        musicYt = { ready: false, time: 0, duration: 0, state: null };
    }

    function stopMusic() {
        teardownMusicPlayer();
        musicStatus = '';
        setMusicPlaying(false);
        renderMusicPanel();
    }

    // Leaving the chat screen: the next chat opened starts its own music again.
    function leaveChatMusic() {
        stopMusic();
        musicCurrentCharId = null;
        musicCurrentChatId = null;
    }

    function musicYtSend(func, args = []) {
        musicIframeEl?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: MUSIC_YT_ID, channel: 'widget' }), '*');
    }

    // The embed only reports its state once asked to, and the first request
    // can arrive before its script listens, so it is repeated until answered.
    function listenToMusicEmbed(iframe) {
        let tries = 0;
        const ask = () => {
            if (iframe !== musicIframeEl || musicYt.ready || tries++ > 40) return;
            iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: MUSIC_YT_ID, channel: 'widget' }), '*');
            setTimeout(ask, 250);
        };
        ask();
    }

    function onMusicTrackFailed(message) {
        const failedIndex = musicIndex;
        musicFailures++;
        teardownMusicPlayer();
        musicStatus = message;
        setMusicPlaying(false);
        renderMusicPanel();
        // Skip past it, unless every track has now failed in a row.
        if (musicPlaylist.length > 1 && musicFailures < musicPlaylist.length) {
            setTimeout(() => {
                if (musicIndex === failedIndex && !musicHasTrack()) playMusicTrack(nextMusicIndex(1, true) ?? musicOrder[0]);
            }, 1500);
        }
    }

    function playMusicTrack(index) {
        teardownMusicPlayer();
        musicStatus = '';
        if (!musicPlaylist.length || index == null) {
            musicIndex = -1;
            setMusicPlaying(false);
            renderMusicPanel();
            return;
        }
        const n = musicPlaylist.length;
        musicIndex = ((index % n) + n) % n;
        if (!musicOrder.includes(musicIndex)) rebuildMusicOrder();
        const url = musicPlaylist[musicIndex];
        const ytId = extractYouTubeId(url);
        if (ytId) {
            const params = new URLSearchParams({ autoplay: '1', enablejsapi: '1', playsinline: '1' });
            if (/^https?:$/.test(location.protocol)) params.set('origin', location.origin);
            const iframe = document.createElement('iframe');
            iframe.src = `https://www.youtube.com/embed/${ytId}?${params}`;
            iframe.allow = 'autoplay';
            iframe.style.cssText = 'display:none;width:0;height:0;border:0;position:absolute;';
            iframe.addEventListener('load', () => listenToMusicEmbed(iframe));
            document.body.appendChild(iframe);
            musicIframeEl = iframe;
        } else {
            const audio = document.createElement('audio');
            audio.preload = 'auto';
            audio.loop = musicLoopsItself();
            audio.volume = musicVolume / 100;
            const current = () => audio === musicAudioEl;
            audio.addEventListener('timeupdate', () => { if (current()) updateMusicTimeline(); });
            audio.addEventListener('durationchange', () => { if (current()) updateMusicTimeline(); });
            audio.addEventListener('playing', () => { if (current()) { musicFailures = 0; setMusicPlaying(true); renderMusicPlaylist(); } });
            audio.addEventListener('pause', () => { if (current() && !audio.ended) { setMusicPlaying(false); renderMusicPlaylist(); } });
            audio.addEventListener('ended', () => { if (current()) onMusicTrackEnded(); });
            audio.addEventListener('error', () => { if (current()) onMusicTrackFailed("Couldn't load this audio link."); });
            audio.src = url;
            document.body.appendChild(audio);
            musicAudioEl = audio;
            audio.play().catch(() => { if (current()) setMusicPlaying(false); });
        }
        setMusicPlaying(true);
        renderMusicPanel();
    }

    // The playlist index `step` places away in play order, or null when that
    // runs off the end and the playlist does not repeat (`auto` = the track
    // simply ended; pressing ⏭ always wraps around).
    function nextMusicIndex(step, auto = false) {
        if (!musicPlaylist.length) return null;
        if (musicOrder.length !== musicPlaylist.length) rebuildMusicOrder();
        const pos = Math.max(0, musicOrder.indexOf(musicIndex));
        const target = pos + step;
        if (target >= 0 && target < musicOrder.length) return musicOrder[target];
        if (auto && musicRepeat === 'off') return null;
        if (musicShuffle && target >= musicOrder.length) {
            const last = musicIndex;
            musicIndex = -1;
            rebuildMusicOrder();
            musicIndex = last;
            // A fresh shuffle should not open with the track that just ended.
            if (musicOrder.length > 1 && musicOrder[0] === last) musicOrder.push(musicOrder.shift());
            return musicOrder[0];
        }
        return musicOrder[(target + musicOrder.length) % musicOrder.length];
    }

    function restartMusicTrack() {
        seekMusicTo(0);
        if (musicAudioEl) musicAudioEl.play().catch(() => {});
        if (musicIframeEl) musicYtSend('playVideo');
        setMusicPlaying(true);
    }

    function onMusicTrackEnded() {
        if (musicLoopsItself()) { restartMusicTrack(); return; }
        const next = nextMusicIndex(1, true);
        if (next === null) {
            // End of a playlist that does not repeat: rewind to the start and stop.
            teardownMusicPlayer();
            musicIndex = musicOrder[0] ?? -1;
            setMusicPlaying(false);
            renderMusicPanel();
            return;
        }
        playMusicTrack(next);
    }

    function seekMusicTo(seconds) {
        if (musicAudioEl) musicAudioEl.currentTime = seconds;
        if (musicIframeEl) {
            musicYtSend('seekTo', [seconds, true]);
            musicYt.time = seconds;
        }
        updateMusicTimeline();
    }

    function pauseMusic() {
        if (musicAudioEl) musicAudioEl.pause();
        if (musicIframeEl) musicYtSend('pauseVideo');
        setMusicPlaying(false);
        renderMusicPlaylist();
    }

    function resumeMusic() {
        if (musicAudioEl) musicAudioEl.play().catch(() => setMusicPlaying(false));
        if (musicIframeEl) musicYtSend('playVideo');
        setMusicPlaying(true);
        renderMusicPlaylist();
    }

    function toggleMusicPlayback() {
        if (musicIsPlaying) pauseMusic();
        else if (musicHasTrack()) resumeMusic();
        else if (musicPlaylist.length) playMusicTrack(musicIndex >= 0 ? musicIndex : (musicOrder[0] ?? 0));
    }

    function previousMusicTrack() {
        // Like any player: well into a track, ⏮ goes back to its start.
        if (musicHasTrack() && musicTimes().time > 3) { seekMusicTo(0); return; }
        playMusicTrack(nextMusicIndex(-1));
    }

    function nextMusicTrack() {
        playMusicTrack(nextMusicIndex(1));
    }

    function setMusicVolume(value, persist = true) {
        musicVolume = Math.min(100, Math.max(0, Math.round(value)));
        if (musicVolume > 0) musicVolumeBeforeMute = musicVolume;
        if (musicAudioEl) musicAudioEl.volume = musicVolume / 100;
        if (musicIframeEl) musicYtSend('setVolume', [musicVolume]);
        if (persist) localStorage.setItem('cccMusicVolume', String(musicVolume));
        renderMusicControls();
    }

    function handleMusicYtState(state) {
        if (state === musicYt.state) return;
        musicYt.state = state;
        if (state === 1) { musicFailures = 0; musicStatus = ''; setMusicPlaying(true); renderMusicPlaylist(); }
        else if (state === 2) { setMusicPlaying(false); renderMusicPlaylist(); }
        else if (state === 0) onMusicTrackEnded();
    }

    window.addEventListener('message', (event) => {
        if (!musicIframeEl || event.source !== musicIframeEl.contentWindow) return;
        let data = event.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return; }
        }
        if (!data || typeof data !== 'object') return;
        const info = data.info;
        if (data.event === 'onError') {
            const code = Number(info);
            onMusicTrackFailed(code === 101 || code === 150 ? "This video's owner doesn't allow it to play in other apps."
                : code === 153 ? 'YouTube refused to play it here. Open the app from its web address instead of a file.'
                : code === 100 || code === 2 ? "This YouTube video doesn't exist or is private."
                : "YouTube couldn't play this video.");
            return;
        }
        if (data.event === 'onReady' || data.event === 'initialDelivery' || data.event === 'infoDelivery') {
            if (!musicYt.ready) {
                musicYt.ready = true;
                musicYtSend('setVolume', [musicVolume]);
                if (!musicIsPlaying) musicYtSend('pauseVideo');
                // Autoplay can be refused without a word from the embed; a
                // player still not started by now is shown as paused.
                const iframe = musicIframeEl;
                setTimeout(() => {
                    if (iframe === musicIframeEl && musicIsPlaying && [null, -1, 5].includes(musicYt.state)) {
                        setMusicPlaying(false);
                        renderMusicPlaylist();
                    }
                }, 3000);
            }
        }
        if (data.event === 'onStateChange' && typeof info === 'number') handleMusicYtState(info);
        if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && info && typeof info === 'object') {
            if (typeof info.currentTime === 'number') musicYt.time = info.currentTime;
            if (typeof info.duration === 'number') musicYt.duration = info.duration;
            const title = info.videoData?.title;
            const ytId = extractYouTubeId(musicPlaylist[musicIndex] || '');
            if (title && ytId && (!info.videoData.video_id || info.videoData.video_id === ytId)) rememberMusicTitle(ytId, title);
            if (typeof info.playerState === 'number') handleMusicYtState(info.playerState);
            updateMusicTimeline();
        }
    });

    function addMusicTracks(text) {
        const urls = parseMusicList(text);
        if (!urls.length) return;
        const wasEmpty = !musicPlaylist.length;
        musicFailures = 0;
        const firstNew = musicPlaylist.length;
        musicPlaylist.push(...urls);
        rebuildMusicOrder();
        saveMusicList();
        if (musicUrlInput) musicUrlInput.value = '';
        // Adding to an idle player plays what was added; otherwise it queues.
        if (wasEmpty || !musicHasTrack()) playMusicTrack(firstNew);
        else renderMusicPanel();
    }

    function removeMusicTrack(i) {
        const wasCurrent = i === musicIndex;
        const wasActive = musicHasTrack();
        const resume = musicIsPlaying;
        musicPlaylist.splice(i, 1);
        if (i < musicIndex) musicIndex--;
        saveMusicList();
        if (wasCurrent) {
            teardownMusicPlayer();
            if (!musicPlaylist.length) musicIndex = -1;
            else musicIndex = Math.min(i, musicPlaylist.length - 1);
            rebuildMusicOrder();
            if (wasActive && resume && musicPlaylist.length) { playMusicTrack(musicIndex); return; }
            setMusicPlaying(false);
        } else {
            rebuildMusicOrder();
        }
        renderMusicPanel();
    }

    function moveMusicTrack(i, step) {
        const j = i + step;
        if (j < 0 || j >= musicPlaylist.length) return;
        [musicPlaylist[i], musicPlaylist[j]] = [musicPlaylist[j], musicPlaylist[i]];
        if (musicIndex === i) musicIndex = j;
        else if (musicIndex === j) musicIndex = i;
        rebuildMusicOrder();
        saveMusicList();
        renderMusicPanel();
    }

    // Called by startChat. Reopening the chat that is already playing leaves
    // the music alone, and so does moving to a chat with the same playlist.
    function loadChatMusic(charId, chatId) {
        const isNewSession = charId !== musicCurrentCharId || chatId !== musicCurrentChatId;
        const list = savedMusicList(charId);
        const samePlaylist = list.join('\n') === musicPlaylist.join('\n');
        musicCurrentCharId = charId;
        musicCurrentChatId = chatId;
        if (!samePlaylist) {
            const currentUrl = musicPlaylist[musicIndex];
            musicPlaylist = list;
            musicIndex = currentUrl ? list.indexOf(currentUrl) : -1;
            rebuildMusicOrder();
        }
        if (isNewSession && !(samePlaylist && musicHasTrack())) {
            musicFailures = 0;
            if (list.length) playMusicTrack(musicShuffle ? musicOrder[0] : 0);
            else { musicIndex = -1; stopMusic(); }
            return;
        }
        // The list changed under the track that is on (the character was edited).
        if (musicIndex === -1 && musicHasTrack()) { stopMusic(); return; }
        renderMusicPanel();
    }

    if (musicBtn) {
        musicBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!musicPanel) return;
            musicPanel.classList.toggle('hidden');
            musicBtn.setAttribute('aria-expanded', String(!musicPanel.classList.contains('hidden')));
            renderMusicPanel();
        });
    }
    document.addEventListener('click', (e) => {
        if (musicPanel && !musicPanel.classList.contains('hidden') &&
            !musicBtn?.contains(e.target) && !musicPanel.contains(e.target) && e.target.isConnected) {
            musicPanel.classList.add('hidden');
            musicBtn?.setAttribute('aria-expanded', 'false');
        }
    });
    musicPlayBtn?.addEventListener('click', toggleMusicPlayback);
    musicStopBtn?.addEventListener('click', stopMusic);
    musicPrevBtn?.addEventListener('click', previousMusicTrack);
    musicNextBtn?.addEventListener('click', nextMusicTrack);
    musicShuffleBtn?.addEventListener('click', () => {
        musicShuffle = !musicShuffle;
        localStorage.setItem('cccMusicShuffle', musicShuffle ? '1' : '0');
        rebuildMusicOrder();
        renderMusicControls();
    });
    musicRepeatBtn?.addEventListener('click', () => {
        musicRepeat = musicRepeat === 'all' ? 'one' : musicRepeat === 'one' ? 'off' : 'all';
        localStorage.setItem('cccMusicRepeat', musicRepeat);
        if (musicAudioEl) musicAudioEl.loop = musicLoopsItself();
        renderMusicControls();
    });
    if (musicSeek) {
        musicSeek.addEventListener('input', () => {
            musicSeeking = true;
            paintMusicSeek(Number(musicSeek.value), Number(musicSeek.max));
        });
        musicSeek.addEventListener('change', () => {
            musicSeeking = false;
            seekMusicTo(Number(musicSeek.value));
        });
    }
    musicVolumeSlider?.addEventListener('input', () => setMusicVolume(Number(musicVolumeSlider.value), false));
    musicVolumeSlider?.addEventListener('change', () => setMusicVolume(Number(musicVolumeSlider.value)));
    musicMuteBtn?.addEventListener('click', () => setMusicVolume(musicVolume === 0 ? musicVolumeBeforeMute : 0));
    musicAddBtn?.addEventListener('click', () => addMusicTracks(musicUrlInput?.value));
    if (musicUrlInput) {
        musicUrlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addMusicTracks(musicUrlInput.value); }
        });
        // A one-line box would run several pasted lines together; each line is its own track.
        musicUrlInput.addEventListener('paste', (e) => {
            const text = e.clipboardData?.getData('text') || '';
            if (parseMusicList(text).length > 1) { e.preventDefault(); addMusicTracks(text); }
        });
    }
    musicPlaylistEl?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const i = Number(btn.dataset.index);
        if (btn.dataset.action === 'play') {
            if (i === musicIndex && musicHasTrack()) toggleMusicPlayback();
            else { musicFailures = 0; playMusicTrack(i); }
        }
        else if (btn.dataset.action === 'up') moveMusicTrack(i, -1);
        else if (btn.dataset.action === 'down') moveMusicTrack(i, 1);
        else if (btn.dataset.action === 'remove') removeMusicTrack(i);
    });
    musicResetBtn?.addEventListener('click', () => {
        if (!musicCurrentCharId) return;
        localStorage.removeItem(`userMusicUrl:${musicCurrentCharId}`);
        const chatId = musicCurrentChatId;
        musicCurrentChatId = null;              // treated as a fresh start for this chat
        loadChatMusic(musicCurrentCharId, chatId);
    });
    if ('mediaSession' in navigator) {
        const handlers = {
            play: () => { if (!musicIsPlaying) toggleMusicPlayback(); },
            pause: pauseMusic,
            previoustrack: previousMusicTrack,
            nexttrack: nextMusicTrack
        };
        for (const [action, handler] of Object.entries(handlers)) {
            try { navigator.mediaSession.setActionHandler(action, () => { if (musicPlaylist.length) handler(); }); } catch (e) { /* unsupported action */ }
        }
    }
    renderMusicControls();
    // Mark Feature B as ready; start the music of a chat that opened before it was.
    window._musicFeatureReady = true;
    if (currentCharacterId && currentChatId && characters[currentCharacterId]) loadChatMusic(currentCharacterId, currentChatId);

    // ── Feature C: TTS ──
    // The dropdown lists English and Japanese for everyone, plus the language of wherever
    // the user is. Their browser locales answer that for most people; the time zone's
    // country covers someone living abroad on an English-language browser, which is the
    // case navigator.languages gets wrong. Zones whose language is English or Japanese are
    // left out of the table below — those two are always listed anyway.
    const TTS_ZONE_REGIONS = {
        // Europe
        'Europe/Amsterdam': 'NL', 'Europe/Andorra': 'AD', 'Europe/Athens': 'GR', 'Europe/Belgrade': 'RS',
        'Europe/Berlin': 'DE', 'Europe/Bratislava': 'SK', 'Europe/Brussels': 'BE', 'Europe/Bucharest': 'RO',
        'Europe/Budapest': 'HU', 'Europe/Busingen': 'DE', 'Europe/Chisinau': 'MD', 'Europe/Copenhagen': 'DK',
        'Europe/Helsinki': 'FI', 'Europe/Istanbul': 'TR', 'Asia/Istanbul': 'TR', 'Europe/Kaliningrad': 'RU',
        'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Europe/Lisbon': 'PT', 'Europe/Ljubljana': 'SI',
        'Europe/Luxembourg': 'LU', 'Europe/Madrid': 'ES', 'Europe/Malta': 'MT', 'Europe/Minsk': 'BY',
        'Europe/Monaco': 'MC', 'Europe/Moscow': 'RU', 'Europe/Nicosia': 'CY', 'Asia/Nicosia': 'CY',
        'Europe/Oslo': 'NO', 'Europe/Paris': 'FR', 'Europe/Podgorica': 'ME', 'Europe/Prague': 'CZ',
        'Europe/Riga': 'LV', 'Europe/Rome': 'IT', 'Europe/Samara': 'RU', 'Europe/San_Marino': 'SM',
        'Europe/Sarajevo': 'BA', 'Europe/Skopje': 'MK', 'Europe/Sofia': 'BG', 'Europe/Stockholm': 'SE',
        'Europe/Tallinn': 'EE', 'Europe/Tirane': 'AL', 'Europe/Vaduz': 'LI', 'Europe/Vatican': 'VA',
        'Europe/Vienna': 'AT', 'Europe/Vilnius': 'LT', 'Europe/Volgograd': 'RU', 'Europe/Warsaw': 'PL',
        'Europe/Zagreb': 'HR', 'Europe/Zurich': 'CH', 'Atlantic/Canary': 'ES', 'Atlantic/Madeira': 'PT',
        'Atlantic/Reykjavik': 'IS',
        // Russia east of the Urals
        'Asia/Yekaterinburg': 'RU', 'Asia/Omsk': 'RU', 'Asia/Novosibirsk': 'RU', 'Asia/Krasnoyarsk': 'RU',
        'Asia/Irkutsk': 'RU', 'Asia/Yakutsk': 'RU', 'Asia/Vladivostok': 'RU', 'Asia/Kamchatka': 'RU',
        // Latin America
        'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX', 'America/Cancun': 'MX',
        'America/Merida': 'MX', 'America/Chihuahua': 'MX', 'America/Mazatlan': 'MX', 'America/Guatemala': 'GT',
        'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN', 'America/Managua': 'NI',
        'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Havana': 'CU',
        'America/Santo_Domingo': 'DO', 'America/Puerto_Rico': 'PR', 'America/Bogota': 'CO',
        'America/Lima': 'PE', 'America/Guayaquil': 'EC', 'America/Caracas': 'VE', 'America/La_Paz': 'BO',
        'America/Asuncion': 'PY', 'America/Montevideo': 'UY', 'America/Santiago': 'CL',
        'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR',
        'America/Argentina/Mendoza': 'AR', 'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR',
        'America/Fortaleza': 'BR', 'America/Recife': 'BR', 'America/Belem': 'BR', 'America/Manaus': 'BR',
        // Asia
        'Asia/Shanghai': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Harbin': 'CN', 'Asia/Urumqi': 'CN',
        'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW', 'Asia/Seoul': 'KR',
        'Asia/Pyongyang': 'KP', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
        'Asia/Jakarta': 'ID', 'Asia/Pontianak': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID',
        'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Manila': 'PH', 'Asia/Kolkata': 'IN',
        'Asia/Calcutta': 'IN', 'Asia/Colombo': 'LK', 'Asia/Dhaka': 'BD', 'Asia/Karachi': 'PK',
        'Asia/Kathmandu': 'NP', 'Asia/Thimphu': 'BT', 'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM',
        'Asia/Phnom_Penh': 'KH', 'Asia/Vientiane': 'LA', 'Asia/Ulaanbaatar': 'MN', 'Asia/Almaty': 'KZ',
        'Asia/Tashkent': 'UZ', 'Asia/Bishkek': 'KG', 'Asia/Dushanbe': 'TJ', 'Asia/Ashgabat': 'TM',
        'Asia/Baku': 'AZ', 'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM', 'Asia/Kabul': 'AF',
        // Middle East
        'Asia/Tehran': 'IR', 'Asia/Baghdad': 'IQ', 'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE',
        'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH', 'Asia/Muscat': 'OM',
        'Asia/Aden': 'YE', 'Asia/Amman': 'JO', 'Asia/Beirut': 'LB', 'Asia/Damascus': 'SY',
        'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Asia/Gaza': 'PS', 'Asia/Hebron': 'PS',
        // Africa
        'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN',
        'Africa/Tripoli': 'LY', 'Africa/Khartoum': 'SD', 'Africa/Addis_Ababa': 'ET', 'Africa/Nairobi': 'KE',
        'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kinshasa': 'CD', 'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN',
        'Africa/Douala': 'CM', 'Africa/Luanda': 'AO', 'Africa/Maputo': 'MZ', 'Indian/Antananarivo': 'MG',
    };

    // Languages to offer on top of English and Japanese, most-local-looking first.
    function getLocalVoiceLangs() {
        const langs = [];
        const addLang = code => {
            const lang = String(code || '').toLowerCase().split(/[-_]/)[0];
            if (lang && lang !== 'und' && !langs.includes(lang)) langs.push(lang);
        };
        // 'AT' → 'de': the language that belongs to a place, which is what a region code or
        // a time zone tells us. Intl.Locale is missing on older browsers, hence the catch.
        const addRegionLang = region => {
            try { addLang(new Intl.Locale('und-' + String(region).toUpperCase()).maximize().language); } catch { }
        };
        [navigator.language, ...(navigator.languages || [])].forEach(tag => {
            if (!tag) return;
            addLang(tag);
            const region = String(tag).split(/[-_]/)[1] || '';
            if (/^[A-Za-z]{2}$/.test(region)) addRegionLang(region);
        });
        try {
            const region = TTS_ZONE_REGIONS[Intl.DateTimeFormat().resolvedOptions().timeZone];
            if (region) addRegionLang(region);
        } catch { }
        return langs;
    }

    function ttsLanguageLabel(lang) {
        try {
            const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
            if (name && name.toLowerCase() !== lang) return name;
        } catch { }
        return lang.toUpperCase();
    }

    function populateTTSVoices() {
        if (!('speechSynthesis' in window)) return;
        const sel = document.getElementById('tts-voice-select');
        if (!sel) return;
        const voices = speechSynthesis.getVoices();
        sel.innerHTML = '<option value="">(Default voice)</option>';
        // Android voices report 'en_US' rather than 'en-US', so split on both.
        const langOf = v => String(v.lang || '').toLowerCase().split(/[-_]/)[0];
        const langs = ['en', 'ja'];
        getLocalVoiceLangs().forEach(lang => { if (!langs.includes(lang)) langs.push(lang); });
        // A voice chosen earlier — on another machine, or before a move abroad — keeps its
        // group even when its language is in none of the above, so the saved selection is
        // never silently dropped from the dropdown.
        const saved = ttsCurrentVoiceURI ? voices.find(v => v.voiceURI === ttsCurrentVoiceURI) : null;
        if (saved && !langs.includes(langOf(saved))) langs.push(langOf(saved));
        langs.forEach(lang => {
            const inLang = voices.filter(v => langOf(v) === lang);
            if (!inLang.length) return;
            const og = document.createElement('optgroup');
            og.label = ttsLanguageLabel(lang);
            inLang.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.voiceURI;
                opt.textContent = `${v.name} (${v.lang})`;
                og.appendChild(opt);
            });
            sel.appendChild(og);
        });
        if (ttsCurrentVoiceURI) sel.value = ttsCurrentVoiceURI;
    }
    if ('speechSynthesis' in window) {
        speechSynthesis.onvoiceschanged = populateTTSVoices;
        populateTTSVoices();
    }

    function speakText(text, messageId) {
        if (!('speechSynthesis' in window)) return;
        speechSynthesis.cancel();
        // '...' is the streaming placeholder, never real reply text worth reading out.
        if (!text || !text.trim() || text.trim() === '...') return;
        const utter = new SpeechSynthesisUtterance(text);
        const sel = document.getElementById('tts-voice-select');
        const voiceURI = sel?.value || ttsCurrentVoiceURI;
        if (voiceURI) {
            const voice = speechSynthesis.getVoices().find(v => v.voiceURI === voiceURI);
            if (voice) utter.voice = voice;
        }
        const btn = messageId ? document.querySelector(`[data-message-id="${CSS.escape(messageId)}"] .tts-btn`) : null;
        if (btn) btn.textContent = '⏹';
        utter.onend = () => { if (btn) btn.textContent = '🔊'; };
        // Cancelled/interrupted utterances report onerror instead of onend in some browsers.
        utter.onerror = () => { if (btn) btn.textContent = '🔊'; };
        speechSynthesis.speak(utter);
    }

    const ttsToggleEl2 = document.getElementById('tts-toggle');
    const ttsVoiceSelectEl2 = document.getElementById('tts-voice-select');
    if (ttsToggleEl2) addSettingListener(ttsToggleEl2, 'ttsEnabled', 'change');
    if (ttsVoiceSelectEl2) addSettingListener(ttsVoiceSelectEl2, 'ttsVoiceURI', 'change');



    // ── Feature E: Reply Length ──
    const replyLengthSelectEl2 = document.getElementById('reply-length-select');
    if (replyLengthSelectEl2) addSettingListener(replyLengthSelectEl2, 'replyLength', 'change');

    let lastDeletedSnapshot = null;

    function showUndoDeleteFab() {
        chatWindow.querySelectorAll('.inline-undo-delete').forEach(el => el.remove());
        const wrapper = document.createElement('div');
        wrapper.className = 'inline-undo-delete';
        const btn = document.createElement('button');
        btn.className = 'inline-undo-delete-btn';
        btn.textContent = '↩ Undo Delete';
        btn.addEventListener('click', undoDeleteAction);
        wrapper.appendChild(btn);
        chatWindow.appendChild(wrapper);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function hideUndoDeleteFab() {
        chatWindow.querySelectorAll('.inline-undo-delete').forEach(el => el.remove());
        lastDeletedSnapshot = null;
    }

    async function undoDeleteAction() {
        if (!lastDeletedSnapshot) return;
        const { charId, chatId, fromIndex, messages } = lastDeletedSnapshot;
        const chat = characters[charId]?.chats?.[chatId];
        if (!chat) { hideUndoDeleteFab(); return; }
        chat.history.splice(fromIndex, 0, ...messages);
        await saveSingleCharacterToDB(characters[charId]);
        updateTokenCount();
        const currentScroll = chatWindow.scrollTop;
        startChat(charId, chatId);
        chatWindow.scrollTop = currentScroll;
        hideUndoDeleteFab();
    }

    function showModelPickerAndConfirm({ title, infoText, warningText, confirmLabel, defaultModelId }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-alert-overlay';
            const modal = document.createElement('div');
            modal.className = 'custom-alert-modal';
            modal.style.maxWidth = '480px';

            const h3 = document.createElement('h3');
            h3.style.cssText = 'margin:0 0 10px;font-size:1.05em;';
            h3.textContent = title;
            modal.appendChild(h3);

            const p = document.createElement('p');
            p.style.cssText = 'margin:0 0 10px;font-size:0.9em;color:#ccc;line-height:1.5;';
            p.textContent = infoText;
            modal.appendChild(p);

            if (warningText) {
                const warn = document.createElement('p');
                warn.style.cssText = 'margin:0 0 12px;font-size:0.85em;color:#ffaa44;background:rgba(255,150,50,0.08);padding:8px 10px;border-radius:6px;border:1px solid rgba(255,150,50,0.25);';
                warn.textContent = warningText;
                modal.appendChild(warn);
            }

            const modelLabel = document.createElement('label');
            modelLabel.textContent = 'AI Model:';
            modelLabel.style.cssText = 'display:block;margin:0 0 5px;font-size:0.85em;color:#bbb;';
            modal.appendChild(modelLabel);

            const modelDropdown = document.createElement('select');
            modelDropdown.style.cssText = 'width:100%;background:#2a2a3a;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:7px 8px;font-size:0.88em;margin-bottom:14px;box-sizing:border-box;';
            const models = appSettings.availableModels || [];
            if (models.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No models configured';
                modelDropdown.appendChild(opt);
            } else {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name || m.id;
                    if (m.id === defaultModelId) opt.selected = true;
                    modelDropdown.appendChild(opt);
                });
            }
            modal.appendChild(modelDropdown);

            const btns = document.createElement('div');
            btns.className = 'custom-dialog-buttons';
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.className = 'secondary-btn';
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = confirmLabel || 'Confirm';
            confirmBtn.className = 'action-btn';
            if (models.length === 0) confirmBtn.disabled = true;
            btns.appendChild(cancelBtn);
            btns.appendChild(confirmBtn);
            modal.appendChild(btns);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            confirmBtn.focus();
            confirmBtn.addEventListener('click', () => { overlay.remove(); resolve(modelDropdown.value || null); });
            cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
        });
    }

    // `reasoningEffort` defaults to 'auto', which sends no reasoning field and
    // lets a thinking model deliberate as it normally would. Short mechanical
    // jobs can pass 'none' to skip that, where the model supports it.
    // `chat`, when given, is the chat whose running cost this request adds to.
    async function callAISimple(systemPrompt, userMessage, selectedModelId, signal = null, reasoningEffort = 'auto', { chat = null } = {}) {
        const modelId = selectedModelId || modelSelect?.value || defaultSettings.model;
        const lookupId = modelId.replace(/:online$/, '');
        const modelSettings = (appSettings.availableModels || []).find(m => m.id === lookupId);
        const apiKeyToSend = (modelSettings?.apiKey) || appSettings.apiKey;
        const targetApiUrlToSend = (modelSettings?.targetApiUrl) || DEFAULT_API_URL;
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];
        const response = await fetch(targetApiUrlToSend, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKeyToSend}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'Casual Character Chat'
            },
            body: JSON.stringify({
                model: modelId, messages, temperature: 0.7, top_p: 0.95, stream: true,
                ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort, modelId)
            }),
            ...(signal ? { signal } : {})
        });
        if (!response.ok) throw new Error(await response.text());
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let reasoningText = '';
        // Providers report a mid-stream failure as an error object inside an
        // otherwise fine 200. Without this the callers only saw an empty
        // answer and had to guess at the cause.
        let streamError = '';
        let sseBuffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith('data:')) continue;
                const dataContent = line.slice(5).trim();
                if (dataContent === '[DONE]') break;
                try {
                    const parsed = JSON.parse(dataContent);
                    if (parsed.error) streamError = parsed.error.message || JSON.stringify(parsed.error);
                    if (parsed.usage) recordUsageCost(parsed.usage, chat);
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta?.content) fullText += delta.content;
                    reasoningText += extractReasoningDelta(delta);
                } catch (_) {}
            }
        }
        // A thinking model can spend its whole answer in the reasoning channel
        // and return no content at all, which reached the callers as an empty
        // string. The chat stream already falls back to that text rather than
        // showing nothing, and the same is better than nothing here.
        if (!fullText.trim() && reasoningText.trim()) {
            fullText = extractMainFromReasoning(reasoningText);
        }
        if (!fullText.trim() && streamError) throw new Error(streamError);
        return fullText.trim();
    }

    // --- Image generation ---------------------------------------------------

    // Resolves once the browser has actually decoded the image, so a queued
    // free-tier generation is still "in flight" rather than a broken <img>.
    function preloadImage(url, timeoutMs = IMAGE_GEN_TIMEOUT_MS, signal = null) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            let settled = false;
            const finish = (fn, arg) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
                fn(arg);
            };
            const timer = setTimeout(() => {
                img.src = '';
                finish(reject, new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`));
            }, timeoutMs);
            // Dropping the src is what actually stops the browser fetching it.
            const onAbort = () => {
                img.src = '';
                finish(reject, new DOMException('Cancelled', 'AbortError'));
            };
            if (signal) {
                if (signal.aborted) return onAbort();
                signal.addEventListener('abort', onAbort);
            }
            img.onload = () => finish(resolve, url);
            // An <img> cannot read the response body, so the cause has to be
            // described rather than quoted: the free service returns the same
            // broken load whether it was busy or refused the prompt.
            img.onerror = () => finish(reject, new Error(
                'The free image service did not return a picture. It may be overloaded, or it may have rejected the prompt. Try again, or reword the prompt.'
            ));
            img.src = url;
        });
    }

    // Marks a failure as "the model said no", so the UI can present it as a
    // content decision to act on rather than as a technical error.
    class ImageRefusalError extends Error {
        constructor(message) {
            super(message);
            this.name = 'ImageRefusalError';
        }
    }

    // Providers report a refusal in a lot of different places: an HTTP 403 with
    // metadata.reasons, a finish_reason of IMAGE_SAFETY / PROHIBITED_CONTENT /
    // content_policy_violation, a promptFeedback.blockReason, or a plain 200
    // carrying only the model's own refusal text. These are the keys worth
    // reading whichever shape comes back.
    const IMAGE_REFUSAL_KEYS = /^(message|reasons?|finish_?reason|native_finish_?reason|block_?reason|block_?reason_?message|rai_?filtered_?reason|refusal|error|detail|text|content)$/i;
    const IMAGE_REFUSAL_PATTERN = /image[_\s-]?safety|prohibited[_\s-]?content|content[_\s-]?polic|content filter|safety[_\s-]?filter|safety[_\s-]?setting|moderation|rai[_\s-]?filtered|\brefus|\bblocked\b|not allowed|violat/i;

    // Walks a response body and collects the strings that might explain a
    // refusal, so a message can be built without knowing the exact schema.
    function collectRefusalSignals(node, depth = 0, out = []) {
        if (!node || depth > 6 || out.length > 40) return out;
        if (Array.isArray(node)) {
            node.forEach(item => collectRefusalSignals(item, depth + 1, out));
            return out;
        }
        if (typeof node !== 'object') return out;
        for (const [key, value] of Object.entries(node)) {
            const matchingKey = IMAGE_REFUSAL_KEYS.test(key);
            if (typeof value === 'string') {
                const text = value.trim();
                if (text && matchingKey) out.push({ key, text });
            } else if (matchingKey && Array.isArray(value)) {
                // e.g. metadata.reasons: ["sexual"] - a list of plain strings
                // that would otherwise be skipped as non-objects.
                value.forEach(item => {
                    if (typeof item === 'string' && item.trim()) out.push({ key, text: item.trim() });
                    else collectRefusalSignals(item, depth + 1, out);
                });
            } else {
                collectRefusalSignals(value, depth + 1, out);
            }
        }
        return out;
    }

    function looksLikeRefusal(signals) {
        return signals.some(s => IMAGE_REFUSAL_PATTERN.test(s.text) || IMAGE_REFUSAL_PATTERN.test(s.key));
    }

    // Picks the most human-readable explanation available, preferring a real
    // sentence from the provider over a bare enum like IMAGE_SAFETY.
    function bestRefusalDetail(signals) {
        const sentences = signals
            .map(s => s.text)
            .filter(t => /\s/.test(t) && t.length > 12 && !/^https?:/i.test(t));
        const chosen = sentences.sort((a, b) => b.length - a.length)[0]
            || signals.map(s => s.text).find(t => IMAGE_REFUSAL_PATTERN.test(t))
            || '';
        const clean = chosen.replace(/\s+/g, ' ').trim();
        return clean.length > 220 ? clean.slice(0, 217) + '…' : clean;
    }

    // Turns a provider refusal into something a user can act on. Returns null
    // when the failure is not a content refusal, so normal errors pass through.
    // `noImage` means the request succeeded but produced no picture: on an
    // image endpoint, prose instead of pixels is itself a refusal, whatever
    // the finish reason says (Gemini often reports a plain STOP).
    function explainImageRefusal(payload, { status = 0, noImage = false } = {}) {
        const signals = collectRefusalSignals(payload);
        const moderationStatus = status === 403 || status === 451;
        const spokeInsteadOfDrawing = noImage && signals.some(
            s => /^(content|text|message|refusal)$/i.test(s.key) && /\s/.test(s.text) && s.text.length > 12
        );
        if (!moderationStatus && !spokeInsteadOfDrawing && !looksLikeRefusal(signals)) return null;

        const detail = bestRefusalDetail(signals);
        const lines = ['The image model refused this prompt.'];
        if (detail) {
            // A bare code like IMAGE_SAFETY is a label, not something the model
            // "said", so only real sentences are quoted as speech.
            lines.push(/\s/.test(detail) ? `It said: “${detail}”` : `Reason: ${detail}`);
        }
        lines.push('This image model is moderated and filters sensitive content. Try rewording the prompt.');
        return lines.join('\n\n');
    }

    // Free, no key. The URL is the image: same prompt + seed gives the same
    // picture back, so only the URL is stored and the bytes are re-fetched.
    async function generateViaPollinations({ prompt, seed, width = IMAGE_GEN_SIZE, height = IMAGE_GEN_SIZE, signal = null }) {
        const url = new URL(POLLINATIONS_IMAGE_URL + encodeURIComponent(String(prompt).slice(0, IMAGE_PROMPT_URL_CHARS)));
        url.searchParams.set('width', width);
        url.searchParams.set('height', height);
        url.searchParams.set('seed', seed);
        url.searchParams.set('nologo', 'true');
        const finalUrl = url.toString();
        await preloadImage(finalUrl, IMAGE_GEN_TIMEOUT_MS, signal);
        return { provider: 'pollinations', url: finalUrl, width, height };
    }

    // Paid, reuses the OpenRouter key already in App Settings. Returns base64,
    // which is re-encoded to webp so the stored copy stays around 100KB.
    async function generateViaOpenRouter({ prompt, model, width = IMAGE_GEN_SIZE, height = IMAGE_GEN_SIZE, signal = null }) {
        const modelId = model || imageGenModel;
        const modelSettings = (appSettings.availableModels || []).find(m => m.id === modelId);
        const apiKey = (modelSettings?.apiKey) || appSettings.apiKey;
        if (!apiKey) throw new Error('Set your API key in App Settings first - only free image generation works without API.');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS);
        // A user cancel and the timeout both have to reach the same request.
        const onAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', onAbort);
        }
        let response;
        try {
            response = await fetch(OPENROUTER_IMAGE_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model: modelId, prompt, n: 1 }),
                signal: controller.signal
            });
        } catch (err) {
            if (err.name === 'AbortError') {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                throw new Error('Image request timed out.');
            }
            throw err;
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            let parsed = null;
            try { parsed = JSON.parse(body); } catch (_) {}
            const refusal = explainImageRefusal(parsed || body, { status: response.status });
            if (refusal) throw new ImageRefusalError(refusal);
            // Not a content refusal, so surface the provider's own wording.
            const message = parsed?.error?.message || body.slice(0, 200) || response.statusText;
            throw new Error(`Image request failed (${response.status}): ${message}`);
        }
        const json = await response.json();
        const b64 = json?.data?.[0]?.b64_json;
        if (!b64) {
            // A 200 with no picture is usually a silent refusal: the model
            // returns a finish reason or a sentence explaining itself instead.
            const refusal = explainImageRefusal(json, { status: 200, noImage: true });
            throw refusal
                ? new ImageRefusalError(refusal)
                : new Error('The provider returned no image data.');
        }

        const mediaType = json?.data?.[0]?.media_type || 'image/png';
        const sourceBlob = await (await fetch(`data:${mediaType};base64,${b64}`)).blob();
        const { dataURL } = await imageFileToWebp(sourceBlob, 0.80, 1024);
        return {
            provider: 'openrouter',
            dataUrl: dataURL,
            model: modelId,
            cost: (typeof json?.usage?.cost === 'number') ? json.usage.cost : null,
            width,
            height
        };
    }

    const IMAGE_PROVIDERS = {
        pollinations: { label: 'free', storesBytes: false, generate: generateViaPollinations },
        openrouter: { label: 'OpenRouter, paid', storesBytes: true, generate: generateViaOpenRouter },
    };

    const IMAGE_PROMPT_SYSTEM = `You turn a roleplay scene into a prompt for an image generator.
Reply with ONLY the prompt: a single line of comma-separated visual phrases, at most 60 words.
Describe what is literally visible - subject, appearance, clothing, pose, setting, lighting, mood, art style.
Do not write dialogue, narration, names, or any commentary about the request.`;

    // Raw roleplay prose makes a poor image prompt, so it is distilled first.
    // The free path must keep working when no text model is reachable, so any
    // failure here falls back to the trimmed scene text instead of throwing.
    // What the prompt box shows straight away, with no network round trip.
    function imagePromptFallback(sceneText) {
        return String(sceneText || '').trim().slice(0, IMAGE_PROMPT_FALLBACK_CHARS);
    }

    async function buildImagePrompt(sceneText, character, signal = null) {
        const scene = String(sceneText || '').trim();
        const appearance = String(character?.description || '').trim().slice(0, IMAGE_PROMPT_APPEARANCE_CHARS);
        const fallback = imagePromptFallback(scene);
        if (!scene) return fallback;
        try {
            const sceneForModel = scene.slice(0, IMAGE_PROMPT_SCENE_CHARS);
            const userMessage = appearance
                ? `Character reference:\n${appearance}\n\nScene:\n${sceneForModel}`
                : `Scene:\n${sceneForModel}`;
            // Turning a scene into a comma-separated list is mechanical work,
            // so reasoning is switched off where the model allows it. Without
            // this, a thinking model set as the Suggestions Model spends time
            // and tokens deliberating before writing a single line.
            const distilled = await callAISimple(
                IMAGE_PROMPT_SYSTEM, userMessage, suggestionModelId, signal, 'none', { chat: getCurrentChat() }
            );
            const cleaned = String(distilled || '').replace(/\s+/g, ' ').trim();
            return cleaned || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function countStoredImageBytes(chat) {
        let count = 0;
        for (const entry of (chat?.history || [])) {
            for (const variation of (entry.variations || [])) {
                for (const image of (variation.images || [])) {
                    if (image.dataUrl) count++;
                }
            }
        }
        return count;
    }

    // The app stores a character as one IndexedDB record, so every base64 image
    // is rewritten on each save. Warn before the browser starts refusing writes.
    async function isStorageNearlyFull() {
        try {
            if (!navigator.storage?.estimate) return false;
            const { usage, quota } = await navigator.storage.estimate();
            if (!usage || !quota) return false;
            return (usage / quota) > 0.8;
        } catch (_) {
            return false;
        }
    }

    // Free generation is the default, so the first time one succeeds the user
    // is told once what the paid option buys them. Follows the same
    // localStorage-flag pattern as the help notification.
    const IMAGE_GEN_HINT_KEY = 'hasSeenImageGenHint';

    function maybeShowFreeImageHint(messageElement) {
        if (!messageElement) return;
        try {
            if (localStorage.getItem(IMAGE_GEN_HINT_KEY)) return;
            localStorage.setItem(IMAGE_GEN_HINT_KEY, 'true');
        } catch (_) {
            return;
        }

        const hint = document.createElement('div');
        hint.className = 'image-gen-hint';

        const title = document.createElement('strong');
        title.className = 'image-gen-hint-title';
        title.textContent = '💡 Want better images?';
        hint.appendChild(title);

        const body = document.createElement('span');
        body.append('Free generation is unlimited, but often slow and rough. For fast images and high quality, open ');
        const where = document.createElement('em');
        where.textContent = 'Chat Settings → Features → Image Source';
        body.appendChild(where);
        body.append(' and switch to OpenRouter with your own API key — around $0.002 per image.');
        hint.appendChild(body);

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'image-gen-hint-dismiss';
        dismiss.textContent = 'Got it';
        dismiss.addEventListener('click', () => hint.remove());
        hint.appendChild(dismiss);

        const holder = messageElement.querySelector('.generated-images');
        if (holder) holder.insertAdjacentElement('afterend', hint);
        else messageElement.appendChild(hint);

        // A tall picture pushes the hint below the fold, so scroll its bottom
        // into view rather than doing the minimum ('nearest' barely moves).
        requestAnimationFrame(() => {
            hint.scrollIntoView({ block: 'end', behavior: 'smooth' });
        });
    }

    async function handleGenerateImage(messageId, button) {
        // Generation can take a minute; the picture belongs to this chat even
        // if another one is open by the time it arrives.
        const ownerCharacter = characters[currentCharacterId];
        const chat = ownerCharacter?.chats?.[currentChatId];
        if (!chat) return;
        const message = chat.history.find(m => m.id === messageId);
        if (!message || message.sender !== 'ai') return;

        const variation = message.variations?.[message.activeVariant];
        if (!variation) return;

        const provider = IMAGE_PROVIDERS[imageGenProvider] || IMAGE_PROVIDERS.pollinations;

        if (provider.storesBytes) {
            if (countStoredImageBytes(chat) >= IMAGE_GEN_STORED_LIMIT) {
                showCustomAlert(`This chat already holds ${IMAGE_GEN_STORED_LIMIT} saved images. Remove one with the × button before generating another.`);
                return;
            }
            if (await isStorageNearlyFull()) {
                const proceed = await showCustomConfirm('Browser storage is over 80% full. Saving another image may fail. Generate anyway?');
                if (!proceed) return;
            }
        }

        const speaker = characters[message.speakerId] || characters[currentCharacterId];
        const messageElement = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
        let stopSpinner = null;
        let pendingBlock = null;
        try {
            if (button) {
                button.disabled = true;
                button.textContent = '⏳';
                button.title = 'Generating…';
                stopSpinner = () => {
                    button.disabled = false;
                    button.textContent = '🎨';
                    button.title = 'Illustrate this scene';
                };
            }

            // The box opens immediately with the raw scene text. Refining it
            // through a text model is a network call that grows with message
            // length, so it runs in the background and fills the box when it
            // lands rather than holding the dialog shut until then.
            const refineController = new AbortController();
            const suggestion = buildImagePrompt(variation.main, speaker, refineController.signal);
            let finalPrompt;
            try {
                finalPrompt = await showCustomLargePrompt(
                    'Image prompt — edit it if you like, then press OK.',
                    'Describe the picture you want…',
                    imagePromptFallback(variation.main),
                    // Roomy, so a whole distilled prompt or a long fallback is
                    // visible without scrolling a small box to check the end.
                    12,
                    suggestion
                );
            } finally {
                // Nothing is waiting on it once the dialog closes.
                refineController.abort();
            }
            if (finalPrompt === null) return;
            const prompt = String(finalPrompt).trim();
            if (!prompt) return;

            const controller = new AbortController();
            if (messageElement) {
                pendingBlock = showImagePendingBlock(messageElement, {
                    providerLabel: provider.label,
                    onCancel: () => controller.abort()
                });
            }

            const seed = Math.floor(Math.random() * 1000000);
            const result = await provider.generate({
                prompt,
                seed,
                model: imageGenModel,
                width: IMAGE_GEN_SIZE,
                height: IMAGE_GEN_SIZE,
                signal: controller.signal
            });

            const imageRecord = {
                id: 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                prompt,
                seed,
                createdAt: Date.now(),
                ...result
            };

            if (!Array.isArray(variation.images)) variation.images = [];
            variation.images.push(imageRecord);

            try {
                await saveSingleCharacterToDB(ownerCharacter);
            } catch (saveErr) {
                variation.images.pop();
                const quotaHit = saveErr?.name === 'QuotaExceededError'
                    || /quota/i.test(saveErr?.message || '');
                showErrorAlert(quotaHit
                    ? 'Out of browser storage, so the image was not saved. Remove some images or gallery pictures and try again.'
                    : `The image could not be saved: ${saveErr?.message || saveErr}`);
                return;
            }

            updateSingleMessageView(messageId);

            if (imageRecord.provider === 'pollinations') {
                maybeShowFreeImageHint(document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`));
            }

            if (typeof imageRecord.cost === 'number') {
                console.info(`[image] generated via ${imageRecord.provider} for $${imageRecord.cost.toFixed(5)}`);
                recordUsageCost({ cost: imageRecord.cost }, chat);
            }
        } catch (err) {
            if (err?.name === 'AbortError') {
                // Cancelling is a deliberate act, so it passes without an alert.
            } else if (err?.name === 'ImageRefusalError') {
                // Already a full, plain-language explanation.
                showCustomAlert(err.message);
            } else {
                showErrorAlert(`Image generation failed: ${err?.message || err}`);
            }
        } finally {
            if (pendingBlock) pendingBlock.remove();
            if (stopSpinner) stopSpinner();
        }
    }

    async function handleRemoveGeneratedImage(messageId, imageId) {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat) return;
        const message = chat.history.find(m => m.id === messageId);
        const variation = message?.variations?.[message.activeVariant];
        if (!variation || !Array.isArray(variation.images)) return;

        const index = variation.images.findIndex(i => i.id === imageId);
        if (index === -1) return;

        const confirmed = await showCustomConfirm('Remove this image?', true);
        if (!confirmed) return;

        variation.images.splice(index, 1);
        await saveSingleCharacterToDB(characters[currentCharacterId]);
        updateSingleMessageView(messageId);
    }

    function _formatAIError(err, context) {
        const msg = (err && err.message) ? err.message : String(err || '');
        if (msg.includes('fetch') || msg.includes('network') || msg.toLowerCase().includes('failed to fetch')) {
            return `${context} failed: Could not reach the AI provider. Check internet connection and API settings.`;
        }
        if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('forbidden')) {
            return `${context} failed: API key invalid or access denied. Check your API key in App Settings.`;
        }
        if (msg.includes('404') || (msg.toLowerCase().includes('model') && msg.toLowerCase().includes('not found'))) {
            return `${context} failed: Model not found. Try a different model.`;
        }
        if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('quota')) {
            return `${context} failed: Rate limit or quota exceeded. Wait a moment and try again.`;
        }
        if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
            return `${context} failed: The AI provider returned a server error. Try again later.`;
        }
        return `${context} failed: ${msg || 'Unknown error.'}`;
    }

    // ── Reply Suggestions helpers ──

    // A round of suggestions is two short lines, but models package them in
    // every shape imaginable: inside a reasoning block, fenced as code, behind
    // a "Sure, here you go:", numbered, quoted with typographic quotes, or cut
    // off mid-sentence. Refusing any of those shapes costs the user the whole
    // round and surfaces as "Could not parse", so each one is read instead.
    // Strict JSON is tried first and wins outright, so a well-formed answer
    // never goes near the repairs further down.
    const REPLY_OPTION_MAX_CHARS = 400;
    const REPLY_OPTION_MIN_CHARS = 6;
    const REPLY_REASONING_TAGS = 'think|thinking|reason|reasoning|analysis|scratchpad';
    const REPLY_FANCY_QUOTES = '‘’‚‛“”„‟«»';
    // The prompt carries this example pair, and a model that only echoes it has
    // not answered — "Option one." offered as a reply reads as a broken app.
    const REPLY_OPTION_EXAMPLE = ['option one.', 'option two.'];
    // Suggestions are optional garnish, so a provider that has stopped
    // answering may not hold the bar on its spinner indefinitely.
    const REPLY_OPTION_TIMEOUT_MS = 45000;

    // Reasoning has to be dropped with its content, not just its tags. Removing
    // the tags alone left the model's deliberation in the text, where a stray
    // bracket ("two directions: [1] closer, [2] away") was read as the start of
    // the JSON array, and an example quoted back inside it was returned as the
    // answer.
    function stripSuggestionWrapping(raw) {
        let text = sanitizeModelOutput(raw);
        if (!text.trim()) return '';

        text = text.replace(new RegExp(`<\\s*(${REPLY_REASONING_TAGS})\\s*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>`, 'gi'), '\n');
        // A closing tag with no opening one: everything before it was thinking.
        const headless = text.search(new RegExp(`<\\s*/\\s*(${REPLY_REASONING_TAGS})\\s*>`, 'i'));
        if (headless !== -1) {
            const tagEnd = text.indexOf('>', headless);
            text = tagEnd === -1 ? '' : text.slice(tagEnd + 1);
        }
        // An opening tag that never closed: the rest is thinking, and the model
        // never got as far as an answer.
        const unclosed = text.search(new RegExp(`<\\s*(${REPLY_REASONING_TAGS})\\s*>`, 'i'));
        if (unclosed !== -1) text = text.slice(0, unclosed);

        const fenced = text.match(/```[a-z]*\s*([\s\S]*?)```/i);
        if (fenced && fenced[1].trim()) text = fenced[1];
        else text = text.replace(/```[a-z]*/gi, '\n');

        return text.trim();
    }

    function cleanReplyOption(value) {
        let s = sanitizeModelOutput(value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
        if (!s) return '';
        // Quotation marks around spoken words are wanted and kept. A lone one is
        // a leftover from a repaired answer and reads as a typo, so it goes.
        const quoteCount = (s.match(new RegExp(`["${REPLY_FANCY_QUOTES}]`, 'g')) || []).length;
        if (quoteCount % 2 === 1) {
            s = s.replace(new RegExp(`^["${REPLY_FANCY_QUOTES}]`), '')
                 .replace(new RegExp(`["${REPLY_FANCY_QUOTES}]$`), '')
                 .trim();
        }
        if (s.length > REPLY_OPTION_MAX_CHARS) {
            const cut = s.slice(0, REPLY_OPTION_MAX_CHARS);
            const lastSpace = cut.lastIndexOf(' ');
            s = (lastSpace > REPLY_OPTION_MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
        }
        return s.length >= REPLY_OPTION_MIN_CHARS ? s : '';
    }

    // Only ever reached once strict parsing has already failed, so it may be
    // heavy-handed: valid JSON is never put through it.
    function repairJsonish(text) {
        let s = text;
        // Typographic or single quotes used as the string delimiters. Only the
        // ones in delimiter position are touched, so an apostrophe in "don't"
        // and a quoted word inside a sentence both survive.
        s = s.replace(new RegExp(`([\\[{,:]\\s*)['${REPLY_FANCY_QUOTES}]`, 'g'), '$1"');
        s = s.replace(new RegExp(`['${REPLY_FANCY_QUOTES}](\\s*[,\\]}])`, 'g'), '"$1');
        s = s.replace(new RegExp(`^\\s*\\[\\s*['${REPLY_FANCY_QUOTES}]`), '["');
        // ""Doubled"" delimiters, from a model asked for quotation marks inside
        // a quoted string.
        s = s.replace(/""([^"]*)""/g, '"$1"');
        // Bare newlines and tabs inside string values, same as the card generator.
        s = s.replace(/"(?:[^"\\]|\\.)*"/gs, m => m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
        s = s.replace(/,\s*([\]}])/g, '$1');

        let inStr = false, esc = false, depth = 0, openQuote = -1;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\' && inStr) { esc = true; continue; }
            if (ch === '"') { if (!inStr) openQuote = i; inStr = !inStr; continue; }
            if (!inStr) { if (ch === '[') depth++; else if (ch === ']') depth--; }
        }
        // An answer cut off mid-sentence: the half-written option is dropped
        // rather than closed, so "I turn awa" never reaches the user.
        if (inStr && openQuote !== -1) s = s.slice(0, openQuote).replace(/[\s,]+$/, '');
        while (depth-- > 0) s += ']';
        return s;
    }

    function parseLooseJson(text) {
        if (!text || !text.trim()) return null;
        for (const attempt of [text, repairJsonish(text)]) {
            try { return JSON.parse(attempt); } catch (_) {}
        }
        return null;
    }

    function toReplyOptions(value) {
        if (!value) return [];
        let list = null;
        if (Array.isArray(value)) list = value;
        else if (typeof value === 'object') {
            // {"options": [...]} and {"option1": "...", "option2": "..."} are
            // both common answers to "output a JSON array".
            const values = Object.values(value);
            list = values.find(v => Array.isArray(v)) || values.filter(v => typeof v === 'string');
        }
        if (!Array.isArray(list)) return [];
        return list
            .map(item => {
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object') {
                    return Object.values(item).find(v => typeof v === 'string') || '';
                }
                return '';
            })
            .map(cleanReplyOption)
            .filter(Boolean)
            .slice(0, 2);
    }

    function replyOptionsFromJson(text) {
        const candidates = [text];
        // Every '[' is a possible start. Scanning from the first one only, as
        // this used to, let a bracket in prose above the array hide it.
        let starts = 0;
        for (let i = 0; i < text.length && starts < 12; i++) {
            if (text[i] !== '[') continue;
            starts++;
            let ends = 0;
            for (let end = text.indexOf(']', i); end !== -1 && ends < 12; end = text.indexOf(']', end + 1)) {
                candidates.push(text.slice(i, end + 1));
                ends++;
            }
            candidates.push(text.slice(i)); // no closing bracket: cut off
        }
        let best = [];
        for (const candidate of candidates) {
            const options = toReplyOptions(parseLooseJson(candidate));
            if (options.length >= 2) return options;
            if (options.length > best.length) best = options;
        }
        return best;
    }

    // Last resort for an answer that is not JSON at all: numbered lines,
    // bullets, or simply the two lines that were asked for.
    function replyOptionsFromLines(text) {
        const out = [];
        for (const rawLine of text.split('\n')) {
            let line = rawLine.trim();
            if (!line) continue;
            line = line.replace(/^[[\s]+/, '').replace(/[\],\s]+$/, '').trim();
            line = line.replace(/^(?:option|reply|choice)?\s*\d+\s*[.):\]-]\s*/i, '')
                       .replace(/^[-*•–—]\s+/, '')
                       .replace(/^(?:option|reply|choice)\s*[a-z0-9]?\s*[:.\-]\s*/i, '')
                       .trim();
            if (!line) continue;
            // A lead-in ("Here are two options:") is not one of the options.
            if (/[:：]$/.test(line) && line.length < 80) continue;
            // "…" — why this option: the note afterwards is not part of the reply.
            const quoted = line.match(new RegExp(`^["${REPLY_FANCY_QUOTES}][\\s\\S]*["${REPLY_FANCY_QUOTES}]`));
            if (quoted && quoted[0].length < line.length && /^[-–—(:,]/.test(line.slice(quoted[0].length).trim())) {
                line = quoted[0];
            }
            const cleaned = cleanReplyOption(line);
            if (cleaned.length < 8) continue;
            out.push(cleaned);
            if (out.length === 2) break;
        }
        return out;
    }

    function usableReplyOptions(options) {
        const out = [];
        for (const option of options) {
            const key = option.toLowerCase();
            if (REPLY_OPTION_EXAMPLE.includes(key)) continue;
            if (out.some(kept => kept.toLowerCase() === key)) continue;
            out.push(option);
        }
        return out;
    }

    // Returns 0, 1 or 2 options. A single one still beats a warning bar, but
    // only when it came from a structured answer — a one-line refusal must not
    // be dressed up as a suggestion, so the line reader needs two lines to
    // count as an answer at all.
    function parseReplyOptions(raw) {
        const text = stripSuggestionWrapping(raw);
        if (!text) return [];
        const fromJson = usableReplyOptions(replyOptionsFromJson(text));
        if (fromJson.length >= 2) return fromJson;
        const fromLines = usableReplyOptions(replyOptionsFromLines(text));
        if (fromLines.length >= 2) return fromLines;
        return fromJson.slice(0, 1);
    }

    function replyOptionsDropdownEl() {
        return document.getElementById('reply-options-dropdown');
    }

    // The bar sits between the chat and the message box, so opening it shortens
    // the chat window. A reader sitting at the newest message stays there
    // instead of having it pushed out of view.
    function revealReplyOptionsDropdown(dropdown) {
        const wasHidden = dropdown.classList.contains('hidden');
        dropdown.classList.remove('hidden');
        if (wasHidden && chatWindow && chatWindow._autoScroll !== false) {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    }

    function showReplyOptionsDropdown() {
        if (!replyOptionsEnabled) return;
        // Nothing belonging to the previous reply may sit over a reply still
        // being written. Sending a message focuses the message box on its first
        // lines, and that focus used to reopen the bar in the middle of the
        // stream that followed.
        if (chatTurnInProgress || currentStreamController) return;
        const dropdown = replyOptionsDropdownEl();
        if (!dropdown) return;
        if (replyOptionsLoading) { revealReplyOptionsDropdown(dropdown); return; }
        if (!pendingReplyOptions || !pendingReplyOptions.length) return;
        _setReplyDropdownOptions(pendingReplyOptions);
    }

    function hideReplyOptionsDropdown() {
        const dropdown = replyOptionsDropdownEl();
        if (dropdown) dropdown.classList.add('hidden');
        // A bar that closes on a dropped round must not come back still spinning.
        _setReplyRegenBusy(false);
    }

    // Opens the bar on its spinner the moment a reply has finished streaming,
    // so the wait is visible instead of the bar appearing from nowhere whenever
    // the suggestions happen to land.
    function _setReplyRegenBusy(busy) {
        document.getElementById('reply-options-regen-btn')?.classList.toggle('is-busy', busy);
    }

    function _setReplyDropdownLoading() {
        const dropdown = replyOptionsDropdownEl();
        if (!dropdown) return;
        dropdown.querySelectorAll('.reply-option-btn').forEach(btn => {
            btn.textContent = '';
            btn.className = 'reply-option-btn reply-option-loading';
            btn.style.display = '';
        });
        _setReplyRegenBusy(true);
        revealReplyOptionsDropdown(dropdown);
    }

    function _setReplyDropdownOptions(options) {
        const dropdown = replyOptionsDropdownEl();
        if (!dropdown) return;
        // One usable option beats an error, so the second button steps aside
        // when only one survived.
        dropdown.querySelectorAll('.reply-option-btn').forEach((btn, index) => {
            const text = options[index] || '';
            btn.textContent = text;
            btn.className = 'reply-option-btn';
            btn.style.display = text ? '' : 'none';
        });
        _setReplyRegenBusy(false);
        revealReplyOptionsDropdown(dropdown);
    }

    function _setReplyDropdownError(msg) {
        const dropdown = replyOptionsDropdownEl();
        if (!dropdown) return;
        const [btn1, btn2] = dropdown.querySelectorAll('.reply-option-btn');
        const shortMsg = msg.length > 160 ? msg.substring(0, 157) + '…' : msg;
        if (btn1) { btn1.textContent = `⚠ ${shortMsg}`; btn1.className = 'reply-option-btn reply-option-error'; btn1.style.display = ''; }
        if (btn2) { btn2.textContent = ''; btn2.className = 'reply-option-btn'; btn2.style.display = 'none'; }
        // The error stays on screen with the button live next to it, so a round
        // lost to a hiccup can be retried without touching the message box.
        _setReplyRegenBusy(false);
        revealReplyOptionsDropdown(dropdown);
    }

    // Drops a round nobody is waiting for any more. Bumping the id alone was
    // not enough: a round only clears the loading flag when the id still
    // matches, so a superseded one used to leave the flag set for good, which
    // pinned the bar on its spinner and stopped the message box from ever
    // asking for suggestions again.
    function cancelReplyOptions({ hide = true } = {}) {
        replyOptionsReqId++;
        replyOptionsLoading = false;
        pendingReplyOptions = null;
        replyOptionsForMessageId = null;
        if (replyOptionsController) {
            replyOptionsController.abort();
            replyOptionsController = null;
        }
        if (hide) hideReplyOptionsDropdown();
    }

    // Separates "the request failed" from "the request worked, the answer was
    // not usable", so the second is reported in its own words instead of being
    // run through the transport wording, which would blame the connection for
    // what the model wrote.
    class ReplyOptionsError extends Error {
        constructor(message) {
            super(message);
            this.name = 'ReplyOptionsError';
        }
    }

    async function requestReplyOptions(attempts, modelId, reqId) {
        let lastFailure = 'The model did not return any reply options.';
        for (const attempt of attempts) {
            const controller = new AbortController();
            replyOptionsController = controller;
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REPLY_OPTION_TIMEOUT_MS);
            let raw = '';
            try {
                // Suggestions appear while the user is deciding what to type, so
                // speed matters more than deliberation. Reasoning is switched off
                // where the model allows it, as with the image prompt builder.
                raw = await callAISimple(attempt.system, attempt.user, modelId, controller.signal, 'none', { chat: getCurrentChat() });
            } catch (err) {
                if (timedOut) {
                    throw new ReplyOptionsError(`No answer within ${Math.round(REPLY_OPTION_TIMEOUT_MS / 1000)} seconds. A faster Suggestions Model in App Settings will do better.`);
                }
                throw err;
            } finally {
                clearTimeout(timer);
                if (replyOptionsController === controller) replyOptionsController = null;
            }
            // Superseded while the answer was on its way.
            if (replyOptionsReqId !== reqId) return null;

            const options = parseReplyOptions(raw);
            if (options.length) return options;

            console.warn('Reply suggestions: no usable options in this response.', raw);
            lastFailure = raw.trim()
                ? `The model answered with something else: "${raw.trim().replace(/\s+/g, ' ').substring(0, 80)}"`
                : 'The model returned an empty response. Another Suggestions Model in App Settings may work better.';
        }
        throw new ReplyOptionsError(lastFailure);
    }

    // `avoid` carries the suggestions the user just turned down. A second round
    // asked in the same words tends to answer in the same words, so the ones on
    // screen are named in the prompt and ruled out.
    async function generateReplyOptionsInBackground({ avoid = null } = {}) {
        if (!replyOptionsEnabled) return;
        // Characters talking among themselves need no suggestions after every
        // turn; the round is asked for once when they stop.
        if (autoPlayState.running) return;
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat || !chat.history || chat.history.length === 0) return;

        // Suggestions must be based on a finished reply. Focusing the message
        // box mid-stream used to fire this against a half-written sentence, and
        // the model would answer with something that was not a JSON pair, which
        // surfaced as a parse error. The stream-completion handlers call this
        // again once the reply is done, so bailing out here loses nothing.
        if (chatTurnInProgress || currentStreamController) return;

        // The reply to answer is the last message in the chat. An AI message
        // further up has already been answered, and suggesting replies to that
        // one would talk past the conversation.
        const lastMsg = chat.history[chat.history.length - 1];
        if (!lastMsg || lastMsg.sender === 'user' || lastMsg.isStreaming) return;
        // An error notice is not a reply to answer.
        if (isChatNoticeMessage(lastMsg)) return;
        const lastAIText = (lastMsg.variations?.[lastMsg.activeVariant ?? 0]?.main || '').trim();
        if (!lastAIText || lastAIText.length < 5) return;

        cancelReplyOptions({ hide: false });
        replyOptionsLoading = true;
        replyOptionsForMessageId = lastMsg.id;
        const reqId = ++replyOptionsReqId;

        _setReplyDropdownLoading();

        const character = characters[currentCharacterId];
        const charName = character?.chatName || character?.name || 'the character';
        const persona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
        const personaContext = persona
            ? ` The user is playing as "${persona.chatName || persona.name}" (${(persona.description || '').substring(0, 200)}).`
            : '';
        const modelId = suggestionModelId || modelSelect?.value || defaultSettings.model;
        const scene = lastAIText.substring(0, 600);

        const rejected = (Array.isArray(avoid) ? avoid : [])
            .filter(o => typeof o === 'string' && o.trim())
            .slice(0, 2)
            .map(o => `"${o.trim().substring(0, 200)}"`);
        const avoidClause = rejected.length
            ? ` The user has already seen and rejected these suggestions: ${rejected.join(' ')} — write two fresh options that take clearly different directions, not rewordings of those.`
            : '';

        // The second attempt asks for the same two lines in a shape that has
        // nothing to malform, for a model that cannot hold a JSON array
        // together. It only runs when the first answer carried no options.
        const attempts = [
            {
                system: `You are a creative assistant for a character roleplay chat. Generate exactly 2 reply options that the USER can send to the AI character. Each option must be one full line in first-person voice and in quotation marks. Make them plot-relevant and scene-specific, offering two distinct directions the scene could take. If the user is directly involved in the scene, then the reply options should be what the user says or does in response to the character's latest message. If the user is NOT directly involved in the scene, then the reply options should instead be what the central character says or does in response to the latest scene.${personaContext}${avoidClause} Output ONLY a JSON array with exactly 2 strings and nothing else — no code fence, no commentary, no explanation. Example: ["Option one.", "Option two."]`,
                user: `${charName} just said: "${scene}"\n\nNow provide 2 fitting reply options for the user (in quotation marks!). Each one must be one whole line in length.`
            },
            {
                system: `You are a creative assistant for a character roleplay chat. Write exactly 2 reply options that the USER can send to the AI character, offering two distinct directions the scene could take. Each is one full line in the user's first-person voice, in quotation marks.${personaContext}${avoidClause} Answer with exactly two lines of plain text: the first option on line 1, the second on line 2. No numbering, no labels, no explanation, no JSON, nothing else.`,
                user: `${charName} just said: "${scene}"\n\nWrite the two reply option lines now.`
            }
        ];

        try {
            const options = await requestReplyOptions(attempts, modelId, reqId);
            if (replyOptionsReqId !== reqId || !options) return;
            pendingReplyOptions = options;
            _setReplyDropdownOptions(options);
        } catch (err) {
            if (replyOptionsReqId !== reqId) return;
            // A round dropped on purpose is not a failure and leaves no warning.
            if (err && err.name === 'AbortError') { hideReplyOptionsDropdown(); return; }
            pendingReplyOptions = null;
            _setReplyDropdownError(err instanceof ReplyOptionsError
                ? `Suggestions failed: ${err.message}`
                : _formatAIError(err, 'Suggestions'));
        } finally {
            if (replyOptionsReqId === reqId) replyOptionsLoading = false;
        }
    }

    document.getElementById('reply-options-dropdown')?.addEventListener('mousedown', (e) => {
        // mousedown rather than click throughout, so the press never takes focus
        // off the message box - a blur there closes the bar out from under it.
        if (e.target.closest('#reply-options-regen-btn')) {
            e.preventDefault();
            if (replyOptionsLoading) return;
            const rejected = pendingReplyOptions ? [...pendingReplyOptions] : null;
            generateReplyOptionsInBackground({ avoid: rejected });
            return;
        }
        const btn = e.target.closest('.reply-option-btn');
        if (!btn) return;
        e.preventDefault();
        // A spinner or a warning is not a reply: taking its text would paste
        // the warning into the message box, or wipe what was typed there.
        if (btn.classList.contains('reply-option-loading') || btn.classList.contains('reply-option-error')) return;
        messageInput.value = btn.textContent;
        autoResizeTextarea({ target: messageInput });
        hideReplyOptionsDropdown();
        messageInput.focus();
    });

    // ── AI Scenario Generator ──

    function showScenarioGeneratorModal(charName, isWorld = false) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-alert-overlay';
            const modal = document.createElement('div');
            modal.className = 'custom-alert-modal';
            modal.style.maxWidth = '480px';

            const h3 = document.createElement('h3');
            h3.style.cssText = 'margin:0 0 10px;font-size:1.05em;';
            h3.textContent = '✨ Generate Scenario';
            modal.appendChild(h3);

            const p = document.createElement('p');
            p.style.cssText = 'margin:0 0 12px;font-size:0.9em;color:#ccc;line-height:1.5;';
            p.textContent = isWorld
                ? `Optionally describe elements that must be part of the opening scene in ${charName} (location, conflict, characters, atmosphere…). Leave empty for a random opening scene.`
                : `Optionally describe elements that must be part of the scenario for ${charName} (genre, setting, relationship, circumstances…). Leave empty for a random scenario.`;
            modal.appendChild(p);

            const hintLabel = document.createElement('label');
            hintLabel.textContent = 'Scenario hints (optional):';
            hintLabel.style.cssText = 'display:block;margin:0 0 5px;font-size:0.85em;color:#bbb;';
            modal.appendChild(hintLabel);

            const hintInput = document.createElement('textarea');
            hintInput.placeholder = isWorld
                ? 'e.g. "Marketplace at dusk, political intrigue, the user arrives in the capital as a stranger…"'
                : 'e.g. "Rainy night, enemies to lovers, first meeting after a long absence…"';
            hintInput.rows = 3;
            hintInput.style.cssText = 'width:100%;background:#2a2a3a;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:7px 8px;font-size:0.88em;margin-bottom:14px;box-sizing:border-box;resize:vertical;font-family:inherit;';
            modal.appendChild(hintInput);

            const modelLabel = document.createElement('label');
            modelLabel.textContent = 'AI Model:';
            modelLabel.style.cssText = 'display:block;margin:0 0 5px;font-size:0.85em;color:#bbb;';
            modal.appendChild(modelLabel);

            const modelDropdown = document.createElement('select');
            modelDropdown.style.cssText = 'width:100%;background:#2a2a3a;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:7px 8px;font-size:0.88em;margin-bottom:14px;box-sizing:border-box;';
            const models = appSettings.availableModels || [];
            const currentModelId = modelSelect?.value || defaultSettings.model;
            if (models.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No models configured';
                modelDropdown.appendChild(opt);
            } else {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name || m.id;
                    if (m.id === currentModelId) opt.selected = true;
                    modelDropdown.appendChild(opt);
                });
            }
            modal.appendChild(modelDropdown);

            const btns = document.createElement('div');
            btns.className = 'custom-dialog-buttons';
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.className = 'secondary-btn';
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'Generate';
            confirmBtn.className = 'action-btn';
            if (models.length === 0) confirmBtn.disabled = true;
            btns.appendChild(cancelBtn);
            btns.appendChild(confirmBtn);
            modal.appendChild(btns);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            hintInput.focus();

            confirmBtn.addEventListener('click', () => {
                overlay.remove();
                resolve({ hints: hintInput.value.trim(), modelId: modelDropdown.value || null });
            });
            cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
        });
    }

    async function handleAIGenerateScenario() {
        const isWorld = cardTypeWorldRadio.checked;
        const worldName = document.getElementById('card-name')?.value.trim() || 'the world';
        const charName = document.getElementById('chat-name')?.value.trim()
            || worldName
            || 'the character';
        const charDesc = document.getElementById('char-description')?.value || '';
        const charLore = document.getElementById('char-lore')?.value || '';

        if (!charDesc.trim() && !charLore.trim()) {
            showCustomAlert(isWorld
                ? 'Please fill in the World Description or World Lore first so the AI can create an authentic opening scene.'
                : 'Please fill in the Character Description or Lorebook first so the AI can create an authentic scenario.');
            return;
        }

        const result = await showScenarioGeneratorModal(isWorld ? worldName : charName, isWorld);
        if (!result) return;

        const { hints, modelId } = result;
        const btn = document.getElementById('ai-scenario-btn');
        const originalText = btn.textContent;
        btn.innerHTML = '<span class="btn-spinner"></span> Generating…';
        btn.disabled = true;

        try {
            const hintSection = hints
                ? `\n\nUser-specified scenario requirements: ${hints}`
                : isWorld
                    ? '\n\nCreate an immersive opening scene that establishes the world.'
                    : '\n\nCreate an authentic scenario that focuses on the character.';

            let systemPrompt;
            if (isWorld) {
                systemPrompt = `You are a creative writer for immersive world roleplay opening scenes. Write a medium-length opening paragraph (100-200 words) set in the world of ${worldName}. Rules:
- Write from an omniscient narrator perspective, establishing the setting and atmosphere of ${worldName}.
- Place the user ("you") into the scene as an active participant discovering or entering the world.
- Introduce at least one named character of ${worldName} who experiences something particular or interacts with the user.
- Weave in at least three lines of dialog from the character in between quotation marks, integrated naturally into the narration.
- Write the narration in a very direct, factual style and focus on relevant information — no prose, no flowery descriptions.
- Prefer short and medium-length sentences over long nested sentences with commas.
- Do not soften any dark, violent, or sexual content and describe it authentically without restriction.

World details:
World: ${worldName}
Description: ${charDesc.substring(0, 900)}
Lore/Background: ${charLore.substring(0, 700)}${hintSection}

Output ONLY the scenario paragraph. No title, no labels, no extra commentary.`;
            } else {
                systemPrompt = `You are a creative writer for character roleplay scenarios. Write a medium-length opening scenario paragraph (100-200 words) for an exciting story with ${charName}. Rules:
- Address ${charName} by name and with "he/she/him/her" in third person — ${charName} is the protagonist of the scene.
- If the user is part of the scenario (check user-specified hints), clarify the relationship or dynamic between ${charName} ("he/she/him/her") and the user ("you").
- Summarize the context of the scene and describe what ${charName} currently experiences or wants.
- Weave in at least three full lines of dialog spoken by ${charName} in between quotation marks, integrated naturally into the narration.
- Write the narration in a very direct, factual style and focus on relevant information - no prose, no flowery descriptions.
- Prefer short and medium-length sentences over long nested sentences with commas.
- Do not soften any dark, violent, or sexual content and describe it authentically without restriction.

Character details:
Name: ${charName}
Description: ${charDesc.substring(0, 900)}
Lore/Background: ${charLore.substring(0, 700)}${hintSection}

Output ONLY the scenario paragraph. No title, no labels, no extra commentary.`;
            }

            const text = await callAISimple(systemPrompt, 'Generate the scenario now.', modelId);
            if (!text || !text.trim()) throw new Error('Empty response from AI.');

            const autoTitle = text.split(/\s+/).slice(0, 5).join(' ').replace(/[.,"!?…]+$/, '') + '…';
            createScenarioInput({ name: autoTitle, text: text.trim() });

            const scenarioList = document.getElementById('scenario-editor-list');
            if (scenarioList?.lastElementChild) {
                scenarioList.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } catch (err) {
            showErrorAlert(_formatAIError(err, 'Scenario generation'));
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }

    // Feature 3: Auto-summarize chat into memory
    document.getElementById('summarize-memories-btn')?.addEventListener('click', async () => {
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
        if (!chat || !chat.history || chat.history.length === 0) {
            showCustomAlert('No messages to summarize yet.');
            return;
        }
        const currentModelId = modelSelect?.value || defaultSettings.model;
        const selectedModelId = await showModelPickerAndConfirm({
            title: '✨ Auto-summarize Chat',
            infoText: 'The selected AI model will read the last 40 messages of this chat and generate a concise bullet-point summary of key events, facts, and story developments. The result will be appended to your Chat Memories — you can review and edit it before saving.',
            confirmLabel: 'Summarize',
            defaultModelId: currentModelId
        });
        if (!selectedModelId) return;
        const btn = document.getElementById('summarize-memories-btn');
        const originalText = btn.textContent;
        btn.innerHTML = '<span class="btn-spinner"></span> Summarizing…';
        btn.disabled = true;
        try {
            const lastMessageId = chat.history[chat.history.length - 1]?.id;
            const historyText = buildSummaryTranscript(historyForPrompt(chat.history).slice(-40), currentCharacterId);
            const summary = await callAISimple(SUMMARY_SYSTEM_PROMPT, `Summarize the key events and facts from this roleplay conversation:\n\n${historyText}`, selectedModelId, null, 'auto', { chat });
            const existing = chatMemoriesTextarea.value.trim();
            chatMemoriesTextarea.value = existing
                ? `${existing}\n\n--- Summary (${new Date().toLocaleDateString()}) ---\n${summary}`
                : summary;
            autoResizeTextarea({ target: chatMemoriesTextarea });
            pendingManualSummary = lastMessageId ? { chat, upToId: lastMessageId } : null;
        } catch (err) {
            showErrorAlert(`Summarization failed: ${err.message}`);
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });

    function showCharacterGeneratorModal(isEditing, isWorld = false) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-alert-overlay';
            const modal = document.createElement('div');
            modal.className = 'custom-alert-modal';
            modal.style.maxWidth = '480px';

            const h3 = document.createElement('h3');
            h3.style.cssText = 'margin:0 0 10px;font-size:1.05em;';
            h3.textContent = isWorld ? '✨ AI Generate World' : '✨ AI Generate Character';
            modal.appendChild(h3);

            const p = document.createElement('p');
            p.style.cssText = 'margin:0 0 12px;font-size:0.9em;color:#ccc;line-height:1.5;';
            p.textContent = isWorld
                ? 'Describe the world you want to create. The AI will generate a complete world card — name, setting description, lore, narrator instructions, and tags.'
                : 'Describe the character you want to create. The AI will generate a complete character card — name, description, tags, and AI instructions.';
            modal.appendChild(p);

            if (isEditing) {
                const warn = document.createElement('p');
                warn.style.cssText = 'margin:0 0 12px;font-size:0.85em;color:#ffaa44;background:rgba(255,150,50,0.08);padding:8px 10px;border-radius:6px;border:1px solid rgba(255,150,50,0.25);';
                warn.textContent = isWorld
                    ? '⚠️ You are editing an existing world. All text fields (description, lore, tags, instructions) will be OVERWRITTEN with newly generated content. Images are kept. This cannot be undone automatically.'
                    : '⚠️ You are editing an existing character. All text fields (description, tags, instructions, names) will be OVERWRITTEN with newly generated content. Images are kept. This cannot be undone automatically.';
                modal.appendChild(warn);
            }

            const descLabel = document.createElement('label');
            descLabel.textContent = isWorld ? 'World concept (optional):' : 'Character concept (optional):';
            descLabel.style.cssText = 'display:block;margin:0 0 5px;font-size:0.85em;color:#bbb;';
            modal.appendChild(descLabel);

            const descInput = document.createElement('textarea');
            descInput.placeholder = isWorld
                ? 'e.g. "A grimdark post-apocalyptic steampunk empire run by immortal machine-gods."\n\nor paste a lore wiki URL below.'
                : 'e.g. "A sarcastic tsundere vampire knight from medieval Japan who loves poetry."\n\nor: "Makima, your possessive mother." (with fandom wiki url)';
            descInput.rows = 4;
            descInput.style.cssText = 'width:100%;background:#2a2a3a;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:7px 8px;font-size:0.88em;margin-bottom:14px;box-sizing:border-box;resize:vertical;font-family:inherit;';
            modal.appendChild(descInput);

            const modelLabel = document.createElement('label');
            modelLabel.textContent = 'AI Model:';
            modelLabel.style.cssText = 'display:block;margin:0 0 5px;font-size:0.85em;color:#bbb;';
            modal.appendChild(modelLabel);

            const modelDropdown = document.createElement('select');
            modelDropdown.style.cssText = 'width:100%;background:#2a2a3a;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:7px 8px;font-size:0.88em;margin-bottom:14px;box-sizing:border-box;';
            const models = appSettings.availableModels || [];
            const currentModelId = modelSelect?.value || defaultSettings.model;
            if (models.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No models configured';
                modelDropdown.appendChild(opt);
            } else {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name || m.id;
                    if (m.id === currentModelId) opt.selected = true;
                    modelDropdown.appendChild(opt);
                });
            }
            modal.appendChild(modelDropdown);

            const urlLabel = document.createElement('label');
            urlLabel.textContent = 'Reference URL (optional):';
            urlLabel.style.cssText = 'display:block;margin:0 0 5px;font-size:0.85em;color:#bbb;';
            modal.appendChild(urlLabel);

            const urlInput = document.createElement('input');
            urlInput.type = 'url';
            urlInput.placeholder = 'https://onepiece.fandom.com/wiki/Roronoa_Zoro';
            urlInput.style.cssText = 'width:100%;background:#2a2a3a;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:7px 8px;font-size:0.88em;margin-bottom:4px;box-sizing:border-box;';
            modal.appendChild(urlInput);

            const urlNote = document.createElement('p');
            urlNote.style.cssText = 'margin:0 0 14px;font-size:0.78em;color:#777;line-height:1.4;';
            urlNote.textContent = isWorld
                ? 'Paste a world wiki or lore page. The AI will read its content and use it as reference for the world card.'
                : 'Paste a character wiki or profile page. The AI will read its content and use it as reference for the character card.';
            modal.appendChild(urlNote);

            const btns = document.createElement('div');
            btns.className = 'custom-dialog-buttons';
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.className = 'secondary-btn';
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'Generate';
            confirmBtn.className = 'action-btn';
            if (models.length === 0) confirmBtn.disabled = true;
            btns.appendChild(cancelBtn);
            btns.appendChild(confirmBtn);
            modal.appendChild(btns);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            descInput.focus();

            confirmBtn.addEventListener('click', () => {
                overlay.remove();
                resolve({ desc: descInput.value.trim(), modelId: modelDropdown.value || null, referenceUrl: urlInput.value.trim() });
            });
            cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
        });
    }

    // Feature 4: AI-assisted character/world creation
    let charGenAbortController = null;
    document.getElementById('ai-generate-char-btn')?.addEventListener('click', async () => {
        const isEditing = !!editingCharField.value;
        const isWorld = cardTypeWorldRadio.checked;
        const result = await showCharacterGeneratorModal(isEditing, isWorld);
        if (!result || !result.modelId) return;
        const { desc, modelId: selectedModelId, referenceUrl } = result;
        const btn = document.getElementById('ai-generate-char-btn');
        const originalText = btn.textContent;
        btn.innerHTML = '<span class="btn-spinner"></span> Generating…';
        btn.disabled = true;
        charGenAbortController = new AbortController();
        const { signal } = charGenAbortController;
        try {
            let refContent = '';
            let refFailed = false;
            if (referenceUrl) {
                btn.innerHTML = '<span class="btn-spinner"></span> Reading reference…';
                try {
                    const fandomMatch = referenceUrl.match(/^https?:\/\/([a-z0-9-]+\.fandom\.com)\/wiki\/([^#?]+)/i);
                    if (fandomMatch) {
                        // Fandom wiki: use MediaWiki API directly — has native CORS support, never bot-blocked
                        const articleTitle = decodeURIComponent(fandomMatch[2].replace(/_/g, ' '));
                        const apiUrl = `https://${fandomMatch[1]}/api.php?action=parse&page=${encodeURIComponent(articleTitle)}&prop=wikitext&format=json&origin=*`;
                        const res = await fetch(apiUrl, { signal });
                        if (res.ok) {
                            const data = await res.json();
                            const wikitext = data?.parse?.wikitext?.['*'];
                            if (wikitext && wikitext.length >= 200) refContent = wikitext.slice(0, 8000);
                            else refFailed = true;
                        } else { refFailed = true; }
                    } else {
                        // Non-Fandom URL: use Jina Reader
                        const jinaRes = await fetch(`https://r.jina.ai/${referenceUrl}`, { headers: { Accept: 'text/plain' }, signal });
                        if (jinaRes.ok) {
                            refContent = (await jinaRes.text()).slice(0, 8000);
                            if (refContent.length < 200) { refContent = ''; refFailed = true; }
                        } else { refFailed = true; }
                    }
                } catch (e) { if (e?.name === 'AbortError') throw e; refFailed = true; }
                btn.innerHTML = '<span class="btn-spinner"></span> Generating…';
            }
            let systemPrompt, userMessage;
            if (isWorld) {
                systemPrompt = `You are a creative world designer for an AI roleplay app. Given a world concept, output a JSON object with exactly these keys:
- worldName: full display name for the world card (e.g. "The Iron Reaches - Steampunk Empire")
- description: a single plain string — detailed world sheet, with these 5 numbered headings written as plain text (NOT as nested JSON keys). Plain text, no nested JSON. Total description between 500 and 1000 words:
  1. Setting — environment, atmosphere, political situation
  [insert line break]
  2. Locations — cities, key locations, social places
  [insert line break]
  3. Population — citizens, species, lifestyle
  [insert line break]
  4. Threats — antagonists, monsters, other dangers etc.
  [insert line break]
  5. World Mechanics — magic, rules, etc.
  [insert line break]
- lore: a single plain string — a bunch of relationships between relevant characters, key historical events, notable conflicts, and secrets/mysteries of this world. Multiple paragraphs, plain text.
- worldRules: short bullet-point rules the AI must always follow in this world (e.g. "Magic is forbidden by law.\\nPeople never experience pain."). These are critical rules that may never be broken.
- tags: 10-20 comma-separated tags (genre, atmosphere, setting type, era, tone, etc.)
Write direct and factual. No prose and no long, nested sentences with commas. 
Stay always in-universe! No meta and no fourth-wall talk. 
Output ONLY the raw JSON object. No markdown fences, no commentary.`;
                userMessage = refContent
                    ? `Create a world based on the following reference material${desc ? ` and this concept: ${desc}` : ''}.\n\nReference:\n${refContent}`
                    : desc ? `Create a world based on this concept: ${desc}` : 'Create a random interesting world.';
            } else {
                systemPrompt = `You are a creative character designer for an AI roleplay app. Given a character concept, output a JSON object with exactly these keys:
- cardName: full display name for the card (e.g. "Yuki Tanaka - Vampire Knight")
- chatName: short in-chat first name (e.g. "Yuki")
- description: a single plain string — detailed character sheet, with these 8 numbered headings written as plain text (NOT as nested JSON keys). Write each section as short phrases, separated by semicolons. No future events for the character, no fourth-wall talk. Always stay in-universe. Total description between 300 and 600 words:
  1. Identity/Role — full name; gender; species; age group; social status/work
  [insert line break]
  2. Personality — core traits, temperament, exceptions/unexpected behaviors
  [insert line break]
  3. Speech Style — main characteristics, sentence structure, verbal quirks
  [insert line break]
  4. Abilities — main skills, talents, superhuman attributes/weapons if character has any
  [insert line break]
  5. Appearance — physical look, clothing, notable features
  [insert line break]
  6. Likes/Dislikes — what they love and what they hate (can include fun facts)
  [insert line break]
  7. Past —  heritage, formative experiences
  [insert line break]
  8. Dialog Examples — 5 lines they might actually say in positive, negative, and romantic contexts (as bullet points, in between quotation marks)
- tags: 10-20 comma-separated tags (genre, personality type, hair color etc.)
- instructions: A few bullet points of AI behavior guidance (e.g. "Stay in character and respond in a dry formal tone.")
Output ONLY the raw JSON object. No markdown fences, no commentary.`;
                userMessage = refContent
                    ? `Create a character based on the following reference material${desc ? ` and this concept: ${desc}` : ''}.\n\nReference:\n${refContent}`
                    : desc ? `Create a character based on this concept: ${desc}` : 'Create a random interesting character.';
            }
            // Escape bare newlines/tabs inside JSON string values (common AI output issue)
            const normalizeJson = s => s.replace(/"(?:[^"\\]|\\.)*"/gs, m => m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
            const result = normalizeJson(await callAISimple(systemPrompt, userMessage, selectedModelId, signal));
            let parsed;
            try {
                // Bracket-counting extraction: handles preamble {braces} before the JSON
                let depth = 0, jsonStart = -1;
                for (let i = 0; i < result.length; i++) {
                    if (result[i] === '{') { if (depth++ === 0) jsonStart = i; }
                    else if (result[i] === '}' && depth > 0 && --depth === 0) {
                        const candidate = result.slice(jsonStart, i + 1);
                        try { parsed = JSON.parse(candidate); break; } catch (_) {}
                        jsonStart = -1;
                    }
                }
                // Repair truncated JSON (response cut off mid-generation)
                if (!parsed && jsonStart !== -1) {
                    try {
                        let frag = result.slice(jsonStart);
                        let inStr = false, esc = false, openD = 0;
                        for (const ch of frag) {
                            if (esc) { esc = false; continue; }
                            if (ch === '\\' && inStr) { esc = true; continue; }
                            if (ch === '"') { inStr = !inStr; continue; }
                            if (!inStr) { if (ch === '{') openD++; else if (ch === '}') openD--; }
                        }
                        let repaired = frag;
                        if (inStr) repaired += '"';
                        while (openD-- > 0) repaired += '}';
                        parsed = JSON.parse(normalizeJson(repaired));
                    } catch (_) {}
                }
                if (!parsed) throw new Error();
            } catch (e) {
                throw new Error(`Could not parse AI response. Got: "${result.slice(0, 120)}"`);
            }
            if (isWorld) {
                if (parsed.worldName) {
                    document.getElementById('card-name').value = parsed.worldName;
                    autoResizeTextarea({ target: document.getElementById('card-name') });
                }
                if (parsed.description) {
                    charDescriptionInput.value = String(parsed.description);
                    autoResizeTextarea({ target: charDescriptionInput });
                }
                if (parsed.lore) {
                    charLoreInput.value = String(parsed.lore);
                    autoResizeTextarea({ target: charLoreInput });
                }
                if (parsed.worldRules) {
                    const reminderEl = document.getElementById('char-reminder');
                    reminderEl.value = String(parsed.worldRules);
                    autoResizeTextarea({ target: reminderEl });
                }
                if (parsed.tags) { document.getElementById('char-tags').value = String(parsed.tags); refreshTagEditorFromField(); }
            } else {
                if (parsed.cardName) {
                    document.getElementById('card-name').value = parsed.cardName;
                    autoResizeTextarea({ target: document.getElementById('card-name') });
                }
                if (parsed.chatName) document.getElementById('chat-name').value = parsed.chatName;
                if (parsed.description) {
                    const descRaw = parsed.description;
                    charDescriptionInput.value = typeof descRaw === 'object'
                        ? Object.entries(descRaw).map(([k, v]) => `${k}\n${v}`).join('\n\n')
                        : String(descRaw);
                    autoResizeTextarea({ target: charDescriptionInput });
                }
                if (parsed.tags) { document.getElementById('char-tags').value = String(parsed.tags); refreshTagEditorFromField(); }
                if (parsed.instructions) {
                    charInstructionsInput.value = parsed.instructions;
                    autoResizeTextarea({ target: charInstructionsInput });
                }
            }
            updateEditorTokenCount();
            if (refFailed) showCustomAlert(`⚠️ The reference URL could not be read (the page may block bots or require login). The ${isWorld ? 'world' : 'character'} was generated without it — you can edit the fields manually.`);
        } catch (err) {
            if (err?.name === 'AbortError') return;
            showErrorAlert(_formatAIError(err, isWorld ? 'World generation' : 'Character generation'));
        } finally {
            charGenAbortController = null;
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });

    // --- END NEW FEATURES ---

    newCharacterBtn.addEventListener('click', openEditorForNew);
    editCharacterBtn.addEventListener('click', openEditorForEdit);
    copyCharacterBtn.addEventListener('click', handleCopyCharacter);
    // The whole card grid is rebuilt per search, so a burst of keystrokes is
    // answered once, just after typing pauses.
    let characterSearchTimer = null;
    const scheduleCharacterListRender = () => {
        clearTimeout(characterSearchTimer);
        characterSearchTimer = setTimeout(() => renderCharacterList(searchInput.value.trim()), 120);
    };
    searchInput.addEventListener('input', scheduleCharacterListRender);

document.getElementById('tag-search-input').addEventListener('input', scheduleCharacterListRender);



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

    const card = document.querySelector(`.character-card[data-char-id="${CSS.escape(charId)}"]`);
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
        const favItem = favBar?.querySelector(`[data-char-id="${CSS.escape(charId)}"]`);
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

                const isWorldFav = character.type === 'world';
                const favImageSource = isWorldFav ? character.background : character.avatar;
                const imageUrl = getImageUrl(favImageSource);
                const favElement = document.createElement('div');
                favElement.className = 'favorite-item';
                favElement.dataset.charId = charId;
                favElement.innerHTML = `
                  <div class="avatar-container">
                    <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(character.name)}" class="${favImageSource ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
                    <div class="placeholder-icon ${favImageSource ? 'hidden' : ''}">${isWorldFav ? '🌍' : '👤'}</div>
                  </div>
                  <span>${escapeHtml(character.name)}</span>`;
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
                favBar.querySelector(`[data-char-id="${CSS.escape(charId)}"]`)?.remove();
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
        // Collapse immediately — #archive-content has no opacity transition,
        // so a delayed collapse just leaves a blank gap for 200ms.
        archiveContent.classList.add('collapsed');
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

    if (chatMemoriesModal) {
        chatMemoriesModal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeChatMemoriesModal();
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
    showReplyOptionsDropdown();
    if (pendingReplyOptions || replyOptionsLoading || !replyOptionsEnabled) return;
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
    const lastMsg = chat?.history?.[chat.history.length - 1];
    if (!lastMsg || lastMsg.sender === 'user') return;
    // A reply that has already had its round is not asked again on every
    // focus. The message box is focused constantly, so a provider that is down
    // would otherwise be retried on each one, silently burning the user's quota.
    if (replyOptionsForMessageId === lastMsg.id) return;
    generateReplyOptionsInBackground();
});

messageInput.addEventListener('click', () => {
    showGroupCharDropdown();
    showReplyOptionsDropdown();
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

if (newChatGroupBtn) newChatGroupBtn.addEventListener('click', handleCreateChatGroup);
if (exitChatGroupBtn) exitChatGroupBtn.addEventListener('click', exitChatGroup);
if (cancelMoveChatBtn) cancelMoveChatBtn.addEventListener('click', closeMoveChatModal);
if (moveChatModal) moveChatModal.addEventListener('click', (e) => {
    if (e.target === moveChatModal) closeMoveChatModal();
});

startNewChatBtn.addEventListener('click', async () => {
    const character = characters[currentCharacterId];
    if (!character.scenarios || character.scenarios.length === 0) {
        await createNewChat();
        return;
    }

    scenarioSelectionList.innerHTML = '';
    character.scenarios.forEach((scenario, index) => {
        const scenarioBtn = document.createElement('button');
        scenarioBtn.className = 'scenario-option-btn';
        scenarioBtn.textContent = scenario.name || 'Unnamed Scenario';
        // The index, not the text: a scenario carries a story line too, and a
        // data attribute can only hold a string.
        scenarioBtn.dataset.scenarioIndex = String(index);
        scenarioSelectionList.appendChild(scenarioBtn);
    });
    scenarioSelectionModal.classList.remove('hidden');
});

scenarioSelectionList.addEventListener('click', async (event) => {
    if (event.target.classList.contains('scenario-option-btn')) {
        const character = characters[currentCharacterId];
        const scenario = (character.scenarios || [])[Number(event.target.dataset.scenarioIndex)];
        if (!scenario) return;
        scenarioSelectionModal.classList.add('hidden');
        await createNewChat(scenario.greeting || '', scenario.name || 'Unnamed Scenario', null, scenario);
    }
});

startEmptyChatBtn.addEventListener('click', async () => {
    scenarioSelectionModal.classList.add('hidden');
    await createNewChat();
});

cancelScenarioSelectionBtn.addEventListener('click', () => {
    scenarioSelectionModal.classList.add('hidden');
});

    /* ================= Character Card Browser bridge =================
     * "Browse Characters" opens the browser, and converted cards come
     * back into this collection over postMessage - no file, no downloads
     * folder, no second trip through the Import Data picker.
     *
     * The app opens the tool rather than the other way round, and hands it
     * this page's origin in the link, so the tool knows where to post back
     * to. That is what lets the same converter serve this app wherever it is
     * running - vercel, a self-hosted copy, a standalone file off the disk -
     * without the tool having to know any of those addresses in advance.
     *
     * Cards only travel inwards. Nothing about this collection is ever sent
     * out; the only thing that goes back is how many characters were added.
     * ================================================================== */
    // The browser ships inside this app, in card-converter/, and is deployed
    // with it - one site and one backend service, not a second of each. The
    // Public app opens its own copy; the Blueprint and standalone copies have
    // no host of their own, so they open the one on the deployed app.
    const CARD_CONVERTER_URL = 'https://casual-character-chat.vercel.app/card-converter/';
    const CARD_IMPORT_PROTOCOL = 'ccc-card-import';

    // The window this app opened itself, kept so an arriving card can be
    // checked against it by reference. A window object cannot be forged or
    // guessed by another page, so `event.source === converterWin` is proof
    // that this is the tool the user just asked for - and that is what earns
    // it the right to skip the confirm below.
    let converterWin = null;

    // The same proof in a form that survives this page being reloaded, which
    // the window reference above does not. A refresh here leaves the tool open
    // in its own tab, still holding a live handle to this one, while this side
    // forgets it ever opened anything - so every later import was met with a
    // confirm dialog, on the tab the user had just navigated away from.
    // Refreshing the app is a normal thing to do; it should not quietly cost
    // the tool its welcome.
    //
    // sessionStorage is exactly the lifetime wanted: per tab, kept across a
    // reload, gone when the tab is. The token is no weaker than the window
    // check it stands in for - it is handed over in the tool's URL hash, which
    // is never sent to a server, is wiped from the address bar the moment the
    // tool reads it, and is unreadable to every other page. Nothing that did
    // not receive it from this tab can produce it.
    const CONVERTER_TOKEN_KEY = 'cccConverterToken';

    function readConverterToken() {
        try {
            return sessionStorage.getItem(CONVERTER_TOKEN_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    // Minted on the way out and only there, so an import from somewhere else
    // never creates the very thing it would have to match.
    function converterToken() {
        const existing = readConverterToken();
        if (existing) return existing;

        // getRandomValues rather than randomUUID: the latter is refused outside
        // a secure context, and a copy of this app served over plain http on a
        // home network is a case the blueprint expects to work.
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

        try {
            sessionStorage.setItem(CONVERTER_TOKEN_KEY, token);
        } catch (e) {
            // Storage turned off. Handing out a token this page cannot remember
            // would only produce a mismatch later, so hand out nothing and let
            // the window check carry it as it always did.
            return '';
        }
        return token;
    }

    function openCardConverter() {
        const url = CARD_CONVERTER_URL
            + '#ccc-import-from=' + encodeURIComponent(location.origin)
            + '&ccc-import-token=' + encodeURIComponent(converterToken());
        converterWin = window.open(url, 'rcc-card-converter');
        if (converterWin) {
            converterWin.focus();
        } else {
            showCustomAlert("Your browser blocked the Character Card Browser tab.\n\nAllow pop-ups for this site and try again.");
        }
    }

    const getCardsBtn = document.getElementById('get-cards-btn');
    if (getCardsBtn) getCardsBtn.addEventListener('click', openCardConverter);

    window.addEventListener('message', async (event) => {
        const msg = event.data;
        // Every embed on the page shares this event - the music player alone
        // talks constantly - so anything without the tag is not ours.
        if (!msg || msg.protocol !== CARD_IMPORT_PROTOCOL) return;

        // A file:// page has the opaque origin "null", which postMessage will
        // not accept as a target. A standalone copy of the converter is a real
        // case, so those are answered with '*'. Safe here: the reply is a
        // count of what was added and holds nothing of the user's.
        const reply = (payload) => {
            const target = (!event.origin || event.origin === 'null') ? '*' : event.origin;
            try {
                event.source?.postMessage({ protocol: CARD_IMPORT_PROTOCOL, v: 1, ...payload }, target);
            } catch (e) { /* the tab went away mid-import; nothing to answer */ }
        };

        if (msg.type === 'hello') {
            // Answered only once the database is open and the collection is
            // loaded. Saying "ready" any earlier would let a card arrive
            // before there is anywhere to put it, and the converter pings
            // until it gets an answer, so waiting costs nothing.
            await appReady;
            reply({ type: 'ready', app: 'Casual Character Chat' });
            return;
        }

        if (msg.type !== 'import') return;

        try {
            await appReady;
            const backup = msg.backup;
            if (!backup || backup.version !== 3 || !backup.characters) {
                reply({ type: 'result', id: msg.id, ok: false, error: 'Unrecognised import format.' });
                return;
            }

            // The tab this app opened is trusted on sight - the user pressed
            // "Browse Characters" to summon it, and asking them to confirm
            // the thing they just asked for is the download step wearing a
            // different hat. Anything else has to say who it is and be let in
            // by hand: postMessage is open to every page on the web, and
            // silently writing into someone's collection is not on.
            //
            // Either proof will do. The window handle answers for as long as
            // this page has been sitting here; the token answers afterwards,
            // once a refresh has taken that handle away. An empty token is not
            // a match for anything - a page sending none, and a page whose
            // storage is switched off, both fall through to the question.
            const known = readConverterToken();
            const vouched = event.source === converterWin
                || (known !== '' && msg.token === known);

            if (!vouched) {
                const count = Object.keys(backup.characters).length;
                const ok = await showCustomConfirm(
                    `${event.origin || 'Another page'} wants to add ${count} character(s) to your collection.\n\nImport them?`
                );
                if (!ok) {
                    reply({ type: 'result', id: msg.id, ok: true, added: 0, skipped: 0, cancelled: true });
                    return;
                }
            }

            const r = await mergeBackupIntoCollection(backup);
            reply({
                type: 'result', id: msg.id, ok: true,
                added: r.charsAdded, skipped: r.charsSkipped,
            });
        } catch (err) {
            reply({ type: 'result', id: msg.id, ok: false, error: err?.message || String(err) });
        }
    });

    exportBtn.addEventListener('click', handleExport);
    importBtn.addEventListener('click', () => {
        // No format picker: handleFileImport sniffs the file itself and routes
        // backups, Character Card JSON and Character Card PNG on its own.
        fileInput.setAttribute('accept', '.json,application/json,image/png');
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
    // The open height is measured rather than hard-coded, so a section can grow
    // when settings are added or when a conditional row appears without its
    // content being clipped by a stale pixel value.
    function closeAccordionSection(section) {
        const content = section.querySelector('.accordion-content');
        if (!content) { section.classList.remove('open'); return; }
        // Collapsing from 'none' would jump, so pin the current height first.
        content.style.maxHeight = `${content.scrollHeight}px`;
        void content.offsetHeight;
        section.classList.remove('open');
        content.style.maxHeight = '';
    }

    function openAccordionSection(section) {
        const content = section.querySelector('.accordion-content');
        section.classList.add('open');
        if (content) content.style.maxHeight = `${content.scrollHeight}px`;
    }

    // Once expanded, drop the cap entirely so later content changes are shown.
    function refreshOpenAccordionHeight() {
        const open = settingsPanel.querySelector('.accordion-section.open .accordion-content');
        if (open) open.style.maxHeight = 'none';
    }

    settingsPanel.querySelectorAll('.accordion-content').forEach(content => {
        content.addEventListener('transitionend', (e) => {
            if (e.propertyName !== 'max-height') return;
            if (content.closest('.accordion-section')?.classList.contains('open')) {
                content.style.maxHeight = 'none';
            }
        });
    });

    settingsPanel.querySelectorAll('.accordion-header').forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.closest('.accordion-section');
            const isOpen = section.classList.contains('open');
            settingsPanel.querySelectorAll('.accordion-section.open').forEach(closeAccordionSection);
            if (!isOpen) openAccordionSection(section);
        });
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
    addSettingListener(reasoningEffortSelect, 'reasoningEffort', 'change');
    addSettingListener(replyOptionsToggle, 'replyOptionsEnabled', 'change');
    addSettingListener(blurSlider, 'blur');
    addSettingListener(avatarSizeSlider, 'avatarSize');
    addSettingListener(modelSelect, 'model', 'change');
    if (suggestionModelSelect) addSettingListener(suggestionModelSelect, 'suggestionModelId', 'change');

    // Image generation is still in testing, so the whole block stays hidden
    // unless this browser has it unlocked. Listeners are registered either way
    // so the settings still round-trip once it launches.
    const imageGenSettingsBlock = document.getElementById('image-gen-settings');
    if (imageGenSettingsBlock && isImageGenUnlocked()) {
        imageGenSettingsBlock.classList.remove('hidden');
    }
    const imageGenToggleEl = document.getElementById('image-gen-toggle');
    const imageGenProviderEl = document.getElementById('image-gen-provider-select');
    const imageGenModelEl = document.getElementById('image-gen-model-input');
    if (imageGenToggleEl) addSettingListener(imageGenToggleEl, 'imageGenEnabled', 'change');
    if (imageGenProviderEl) addSettingListener(imageGenProviderEl, 'imageGenProvider', 'change');
    if (imageGenModelEl) addSettingListener(imageGenModelEl, 'imageGenModel', 'change');

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
            await Promise.all(
                Object.entries(defaultSettings).map(([key, value]) => saveSettingToDB(key, value))
            );
            await loadAndApplySettingsFromDB();
            enforceResponsiveSettingLimits();
        }
    });

    scrollTopFab.addEventListener('click', () => {
        chatWindow.scrollTop = 0;
    });

    let chatScrollSaveTimer = null;
    chatWindow.addEventListener('scroll', () => {
        if (chatWindow.scrollTop > 400) {
            scrollTopFab.classList.add('visible');
        } else {
            scrollTopFab.classList.remove('visible');
        }
        // Remembered at most every 200 ms: a scroll fires dozens of events a
        // second, and each synchronous localStorage write made it stutter.
        const k = (currentCharacterId && currentChatId)
  ? `chatScrollPos:${currentCharacterId}:${currentChatId}`
  : 'chatScrollPos';
        const scrollTopNow = chatWindow.scrollTop;
        if (chatScrollSaveTimer) clearTimeout(chatScrollSaveTimer);
        chatScrollSaveTimer = setTimeout(() => {
            chatScrollSaveTimer = null;
            try { localStorage.setItem(k, String(scrollTopNow)); } catch (_) {}
        }, 200);
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
        // One reply is written at a time. The buttons on other messages stay
        // clickable during a stream, and a second request running alongside
        // shared the one Stop button and the stream state with the first.
        const replyInProgress = chatTurnInProgress || !!currentStreamController;

        if (target.classList.contains('regenerate-btn')) {
            if (replyInProgress) return;
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
            // Not found must not become splice(-1), which deletes the last message.
            if (messageIndex === -1) return;
            const currentScroll = chatWindow.scrollTop;
            lastDeletedSnapshot = { charId: currentCharacterId, chatId: currentChatId, fromIndex: messageIndex, messages: chat.history.splice(messageIndex) };
            await saveSingleCharacterToDB(characters[currentCharacterId]);
            updateTokenCount();
            startChat(currentCharacterId, currentChatId);
            chatWindow.scrollTop = currentScroll;
            showUndoDeleteFab();
            playSound('delete');
            generateReplyOptionsInBackground();
                }
             }
             else if (target.classList.contains('continue-btn')) {
        if (replyInProgress) return;
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
            // Another variant is a different reply, so suggestions written for
            // the old one no longer fit. They are dropped rather than reordered
            // right away: focusing the message box asks for a fitting pair, and
            // browsing variants should not cost a request per click.
            if (messageId === chat.history[chat.history.length - 1]?.id) cancelReplyOptions();
        }
    }
    });



    // Arrow keys belong to whatever has focus. Only when nothing that takes
    // keyboard input is focused do they flip the last reply's variants.
    function isKeyboardInputFocused() {
        const el = document.activeElement;
        if (!el || el === document.body) return false;
        if (el.isContentEditable) return true;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    document.addEventListener('keydown', async (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        // Alt+Left is the browser's Back; shortcuts with a modifier are not ours.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        // The chat screen is hidden with 'is-inactive'; checking for 'hidden'
        // never matched.
        if (chatScreen.classList.contains('is-inactive')) return;
        if (isKeyboardInputFocused()) return;
        if (chatMemoriesModal && !chatMemoriesModal.classList.contains('hidden')) return;
        if (messageEditorModal && !messageEditorModal.classList.contains('hidden')) return;
        
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
                // Ignore regenerate requests while a generation is already
                // streaming; a second press mid-stream corrupts the formatting.
                if (currentStreamController || chatTurnInProgress) return;
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
    const isWorld = characters[currentCharacterId].type === 'world';
    const deletePrompt = isWorld
        ? `Are you sure you want to permanently delete the world "${characterName}" and all its chats?`
        : `Are you sure you want to permanently delete the character "${characterName}" and all their chats?`;
    if (await showCustomConfirm(deletePrompt, true)) {
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



    // =============================================================
    // CHAT TOOLS
    // The message menu (copy, bookmark, hide from AI, branch), the chat menu,
    // search, chat stats with milestones and cost, automatic summaries,
    // "Let Them Talk", automatic atmosphere, voice input, unsent drafts,
    // keyboard shortcuts and the install button.
    // =============================================================

    function getCurrentChat() {
        return characters[currentCharacterId]?.chats?.[currentChatId] || null;
    }

    function getMessageText(message) {
        if (!message) return '';
        if (message.sender === 'user') return message.main || '';
        return message.variations?.[message.activeVariant]?.main || '';
    }

    function isChatScreenActive() {
        return !chatScreen.classList.contains('is-inactive');
    }

    function getCharacterDisplayName(character) {
        if (!character) return 'the character';
        return character.type === 'world' ? (character.name || 'this world') : (character.chatName || character.name || 'the character');
    }

    // ── Toast: one short line at the bottom that fades out by itself ──
    let chatToastTimer = null;
    function showChatToast(text) {
        let toast = document.getElementById('chat-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'chat-toast';
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }
        toast.textContent = text;
        toast.classList.remove('visible');
        void toast.offsetWidth; // restarts the fade when a second toast follows at once
        toast.classList.add('visible');
        clearTimeout(chatToastTimer);
        chatToastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
    }

    // ── Cost ──
    function formatUsd(value) {
        const amount = Number(value) || 0;
        if (amount === 0) return '$0.00';
        if (amount < 0.01) return `$${amount.toFixed(4)}`;
        return `$${amount.toFixed(2)}`;
    }

    // OpenRouter reports the price of every request in the `usage` object at
    // the end of its answer. Other providers send no cost, and add nothing.
    function recordUsageCost(usage, chat) {
        const cost = Number(usage?.cost);
        if (!Number.isFinite(cost) || cost <= 0) return;
        sessionCostUsd += cost;
        if (chat) chat.costUsd = (Number(chat.costUsd) || 0) + cost;
        updateTokenCount();
    }

    // ── Message menu ──
    const messageMenu = document.getElementById('message-menu');
    let messageMenuMessageId = null;

    function closeMessageMenu() {
        if (!messageMenu || messageMenu.classList.contains('hidden')) return;
        messageMenu.classList.add('hidden');
        messageMenuMessageId = null;
    }

    function openMessageMenu(messageId, anchor) {
        const message = getCurrentChat()?.history?.find(m => m.id === messageId);
        if (!messageMenu || !message || !anchor) return;
        closeChatMenu();
        messageMenuMessageId = messageId;
        const streaming = !!message.isStreaming;
        const hidden = isHiddenFromAI(message);
        const setItem = (action, icon, label, disabled = false) => {
            const item = messageMenu.querySelector(`[data-action="${action}"]`);
            if (!item) return;
            item.querySelector('.message-menu-icon').textContent = icon;
            item.querySelector('.message-menu-label').textContent = label;
            item.disabled = disabled;
        };
        setItem('copy', '📋', 'Copy Text', streaming);
        setItem('bookmark', message.bookmarked ? '☆' : '★', message.bookmarked ? 'Remove Bookmark' : 'Bookmark');
        setItem('hide', hidden ? '👁️' : '🙈', hidden ? 'Show to AI Again' : 'Hide from AI', streaming);
        setItem('branch', '🌿', 'Branch from Here', streaming || chatTurnInProgress || !!currentStreamController);

        messageMenu.classList.remove('hidden');
        // Beside the button, and kept on screen near an edge.
        const rect = anchor.getBoundingClientRect();
        const margin = 8;
        const menuWidth = messageMenu.offsetWidth;
        const menuHeight = messageMenu.offsetHeight;
        let left = Math.min(rect.left, window.innerWidth - menuWidth - margin);
        left = Math.max(margin, left);
        let top = rect.bottom + 6;
        if (top + menuHeight > window.innerHeight - margin) top = Math.max(margin, rect.top - menuHeight - 6);
        messageMenu.style.left = `${left}px`;
        messageMenu.style.top = `${top}px`;
        messageMenu.querySelector('.message-menu-item:not(:disabled)')?.focus({ preventScroll: true });
    }

    async function copyMessageText(messageId) {
        const text = getMessageText(getCurrentChat()?.history?.find(m => m.id === messageId));
        if (!text) return;
        let copied = false;
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch (_) {
            // The clipboard API is missing on file:// in some browsers.
            const scratch = document.createElement('textarea');
            scratch.value = text;
            scratch.setAttribute('readonly', '');
            scratch.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
            document.body.appendChild(scratch);
            scratch.select();
            try { copied = document.execCommand('copy'); } catch (_) {}
            scratch.remove();
        }
        showChatToast(copied ? '📋 Copied to the clipboard.' : 'Your browser did not allow copying.');
    }

    async function toggleMessageFlag(messageId, flag) {
        const character = characters[currentCharacterId];
        const message = getCurrentChat()?.history?.find(m => m.id === messageId);
        if (!character || !message) return;
        if (message[flag] === true) delete message[flag];
        else message[flag] = true;
        applyMessageFlags(chatWindow.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`), message);
        await saveSingleCharacterToDB(character);
        if (flag === 'hiddenFromAI') {
            updateTokenCount();
            showChatToast(message.hiddenFromAI
                ? '🙈 Hidden from the AI. It stays in the chat for you.'
                : '👁️ The AI can see this message again.');
        } else if (chatSearch.open && chatSearch.bookmarksOnly) {
            runChatSearch();
        }
    }

    // A new chat holding everything up to and including this message, so a
    // different path can be tried without losing the original one.
    async function branchChatFrom(messageId) {
        const character = characters[currentCharacterId];
        const chat = getCurrentChat();
        if (!character || !chat) return;
        const index = chat.history.findIndex(m => m.id === messageId);
        if (index === -1) return;
        if (chatTurnInProgress || currentStreamController) {
            showChatToast('Wait until the current reply has finished.');
            return;
        }
        const copyOf = value => (typeof structuredClone === 'function'
            ? structuredClone(value)
            : JSON.parse(JSON.stringify(value)));
        const history = copyOf(chat.history.slice(0, index + 1));
        history.forEach(m => { delete m.isStreaming; delete m.streamingVariant; });
        const newChatId = 'chat-' + Date.now();
        const baseName = String(chat.name || 'Chat').replace(/\s*\(branch\)$/i, '');
        character.chats[newChatId] = {
            id: newChatId,
            name: `${baseName} (branch)`,
            history,
            memories: getChatMemories(chat),
            participants: [...(chat.participants || [currentCharacterId])],
            activePersonaId: chat.activePersonaId ?? null,
            mood: normalizeMood(chat.mood),
            groupId: chat.groupId ?? null,
            // Milestones already celebrated in the original are not repeated.
            milestones: Array.isArray(chat.milestones) ? [...chat.milestones] : undefined,
            summarizedUpToId: history.some(m => m.id === chat.summarizedUpToId) ? chat.summarizedUpToId : history[history.length - 1]?.id,
            sceneEffect: chat.sceneEffect,
            branchedFrom: { chatId: chat.id, messageId }
        };
        await saveSingleCharacterToDB(character);
        closeChatSearch();
        window.__scrollToBottomNextStartChat = true;
        await startChat(currentCharacterId, newChatId);
        showChatToast('🌿 New branch created. The original chat is unchanged.');
        playSound('branch');
    }

    chatWindow.addEventListener('click', (event) => {
        const moreBtn = event.target.closest('.message-more-btn');
        if (!moreBtn) return;
        event.stopPropagation();
        const messageId = moreBtn.closest('.message')?.dataset.messageId;
        if (!messageId) return;
        if (messageMenuMessageId === messageId && !messageMenu.classList.contains('hidden')) {
            closeMessageMenu();
        } else {
            openMessageMenu(messageId, moreBtn);
        }
    });

    messageMenu?.addEventListener('click', async (event) => {
        const item = event.target.closest('.message-menu-item');
        if (!item || item.disabled) return;
        const messageId = messageMenuMessageId;
        closeMessageMenu();
        if (!messageId) return;
        switch (item.dataset.action) {
            case 'copy': await copyMessageText(messageId); break;
            case 'bookmark':
                await toggleMessageFlag(messageId, 'bookmarked');
                if (getCurrentChat()?.history?.find(m => m.id === messageId)?.bookmarked === true) playSound('bookmark');
                break;
            case 'hide': await toggleMessageFlag(messageId, 'hiddenFromAI'); break;
            case 'branch': await branchChatFrom(messageId); break;
        }
    });

    document.addEventListener('click', (event) => {
        if (messageMenu && !messageMenu.contains(event.target) && !event.target.closest('.message-more-btn')) {
            closeMessageMenu();
        }
    });
    chatWindow.addEventListener('scroll', closeMessageMenu, { passive: true });
    window.addEventListener('resize', closeMessageMenu);

    // ── Chat menu (⋯ in the header) ──
    const chatMenuBtn = document.getElementById('chat-menu-btn');
    const chatMenu = document.getElementById('chat-menu');
    const chatMenuBookmarkCount = document.getElementById('chat-menu-bookmark-count');
    const chatMenuAutoPlay = document.getElementById('chat-menu-autoplay');

    function closeChatMenu() {
        if (!chatMenu || chatMenu.classList.contains('hidden')) return;
        chatMenu.classList.add('hidden');
        chatMenuBtn?.setAttribute('aria-expanded', 'false');
        setDiceInfoOpen(false);
    }

    // The "?" beside Roll Dice folds its explanation open and shut, and the
    // menu stays open meanwhile. It is folded again whenever the menu closes.
    function setDiceInfoOpen(open) {
        const info = document.getElementById('dice-info');
        const btn = document.getElementById('dice-info-btn');
        if (!info || !btn) return;
        info.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', String(open));
    }

    document.getElementById('dice-info-btn')?.addEventListener('click', () => {
        setDiceInfoOpen(document.getElementById('dice-info')?.classList.contains('hidden'));
    });

    function updateChatMenuItems() {
        const chat = getCurrentChat();
        const bookmarks = (chat?.history || []).filter(m => m.bookmarked === true).length;
        if (chatMenuBookmarkCount) chatMenuBookmarkCount.textContent = bookmarks ? String(bookmarks) : '';
        if (chatMenuAutoPlay) {
            chatMenuAutoPlay.classList.toggle('hidden', getSpeakingParticipants(chat).length < 2);
            chatMenuAutoPlay.querySelector('.chat-menu-icon').textContent = autoPlayState.running ? '⏹️' : '▶️';
            chatMenuAutoPlay.querySelector('.chat-menu-label').textContent = autoPlayState.running ? 'Stop Talking' : 'Let Them Talk';
        }
    }

    chatMenuBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!chatMenu) return;
        if (!chatMenu.classList.contains('hidden')) { closeChatMenu(); return; }
        // The other header popovers stop their clicks from reaching the
        // document, so they are closed here rather than by an outside click.
        document.getElementById('mood-picker')?.classList.add('hidden');
        document.getElementById('music-panel')?.classList.add('hidden');
        closeMessageMenu();
        updateChatMenuItems();
        chatMenu.classList.remove('hidden');
        chatMenuBtn.setAttribute('aria-expanded', 'true');
    });

    ['mood-btn', 'music-btn', 'particle-btn', 'settings-btn', 'quick-swap-btn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', closeChatMenu);
    });

    document.addEventListener('click', (event) => {
        if (chatMenu && !chatMenu.contains(event.target) && !chatMenuBtn?.contains(event.target)) closeChatMenu();
    });

    chatMenu?.addEventListener('click', (event) => {
        const item = event.target.closest('.chat-menu-item[data-action]');
        if (!item) return;
        closeChatMenu();
        switch (item.dataset.action) {
            case 'search': openChatSearch(); break;
            case 'bookmarks': openChatSearch({ bookmarksOnly: true }); break;
            case 'stats': openChatStats(); break;
            case 'autoplay': if (autoPlayState.running) stopAutoPlay(); else startAutoPlay(); break;
            case 'dice': prefillDiceRoll(); break;
            case 'shortcuts': openShortcuts(); break;
        }
    });

    function prefillDiceRoll() {
        const typed = messageInput.value.trim();
        if (!/^\/roll\b/i.test(typed)) {
            messageInput.value = typed ? `/roll 1d20 ${typed}` : '/roll 1d20 ';
        }
        autoResizeTextarea({ target: messageInput });
        scheduleChatDraftSave();
        messageInput.focus();
        messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
        showChatToast('🎲 Press Enter to roll. Change it to e.g. /roll 2d6+3, or add your action after it.');
    }

    // ── Search ──
    const chatSearchBar = document.getElementById('chat-search-bar');
    const chatSearchInput = document.getElementById('chat-search-input');
    const chatSearchCount = document.getElementById('chat-search-count');
    const chatSearchResults = document.getElementById('chat-search-results');
    const chatSearchScopeBtn = document.getElementById('chat-search-scope-btn');
    const chatSearchBookmarksBtn = document.getElementById('chat-search-bookmarks-btn');
    const chatSearchPrevBtn = document.getElementById('chat-search-prev-btn');
    const chatSearchNextBtn = document.getElementById('chat-search-next-btn');
    // matches: message ids in this chat, oldest first. index: the one in focus.
    const chatSearch = { open: false, allChats: false, bookmarksOnly: false, matches: [], index: -1 };
    let chatSearchTimer = null;

    function openChatSearch({ bookmarksOnly = false } = {}) {
        if (!chatSearchBar || !getCurrentChat()) return;
        chatSearch.open = true;
        chatSearch.allChats = false;
        chatSearch.bookmarksOnly = bookmarksOnly;
        chatSearchBar.classList.remove('hidden');
        syncChatSearchControls();
        runChatSearch({ jump: true });
        chatSearchInput.focus();
        chatSearchInput.select();
    }

    function closeChatSearch() {
        if (!chatSearch.open) return;
        chatSearch.open = false;
        chatSearch.matches = [];
        chatSearch.index = -1;
        clearTimeout(chatSearchTimer);
        clearSearchMarks();
        chatWindow.querySelectorAll('.message.search-current').forEach(el => el.classList.remove('search-current'));
        chatSearchBar?.classList.add('hidden');
        if (chatSearchResults) {
            chatSearchResults.classList.add('hidden');
            chatSearchResults.innerHTML = '';
        }
    }

    function syncChatSearchControls() {
        chatSearchScopeBtn?.setAttribute('aria-pressed', String(chatSearch.allChats));
        chatSearchBookmarksBtn?.setAttribute('aria-pressed', String(chatSearch.bookmarksOnly));
        if (chatSearchInput) {
            chatSearchInput.placeholder = chatSearch.allChats
                ? (chatSearch.bookmarksOnly ? '🔎 Bookmarks in all chats...' : '🔎 Search all chats...')
                : (chatSearch.bookmarksOnly ? '🔎 Bookmarks in this chat...' : '🔎 Search this chat...');
        }
        // Stepping through matches only makes sense inside the open chat.
        chatSearchPrevBtn?.classList.toggle('hidden', chatSearch.allChats);
        chatSearchNextBtn?.classList.toggle('hidden', chatSearch.allChats);
    }

    function chatSearchQuery() {
        return (chatSearchInput?.value || '').trim().toLowerCase();
    }

    function messageMatchesSearch(message, query) {
        if (!message || isChatNoticeMessage(message)) return false;
        if (chatSearch.bookmarksOnly && message.bookmarked !== true) return false;
        if (!query) return chatSearch.bookmarksOnly;
        return getMessageText(message).toLowerCase().includes(query);
    }

    function collectChatMatches(query) {
        const chat = getCurrentChat();
        chatSearch.matches = (chat?.history || []).filter(m => messageMatchesSearch(m, query)).map(m => m.id);
        chatSearch.matches.forEach(id => markSearchHits(id, query));
    }

    function runChatSearch({ jump = false } = {}) {
        if (!chatSearch.open) return;
        clearSearchMarks();
        chatWindow.querySelectorAll('.message.search-current').forEach(el => el.classList.remove('search-current'));
        const query = chatSearchQuery();
        if (chatSearch.allChats) {
            renderAllChatsResults(query);
            return;
        }
        chatSearchResults?.classList.add('hidden');
        collectChatMatches(query);
        // The newest match first: that is where the user usually is.
        chatSearch.index = chatSearch.matches.length - 1;
        updateChatSearchCount(query);
        focusSearchMatch({ scroll: jump });
    }

    // After the chat is redrawn (an edit, a deleted message, another chat):
    // the marks are put back without moving the view.
    function refreshChatSearchAfterRender() {
        if (!chatSearch.open || chatSearch.allChats) return;
        const focusedId = chatSearch.matches[chatSearch.index];
        const query = chatSearchQuery();
        collectChatMatches(query);
        const kept = chatSearch.matches.indexOf(focusedId);
        chatSearch.index = kept !== -1 ? kept : chatSearch.matches.length - 1;
        updateChatSearchCount(query);
        focusSearchMatch({ scroll: false });
    }

    function updateChatSearchCount(query) {
        if (!chatSearchCount) return;
        const total = chatSearch.matches.length;
        chatSearchCount.textContent = total
            ? `${chatSearch.index + 1}/${total}`
            : ((query || chatSearch.bookmarksOnly) ? 'No results' : '');
    }

    // direction -1 = older, +1 = newer; wraps around at either end.
    function stepChatSearch(direction) {
        if (chatSearch.allChats) return;
        const total = chatSearch.matches.length;
        if (!total) return;
        chatSearch.index = (chatSearch.index + direction + total) % total;
        updateChatSearchCount(chatSearchQuery());
        focusSearchMatch({ scroll: true });
    }

    function focusSearchMatch({ scroll = true, smooth = true } = {}) {
        chatWindow.querySelectorAll('.message.search-current').forEach(el => el.classList.remove('search-current'));
        const messageId = chatSearch.matches[chatSearch.index];
        if (!messageId) return;
        const el = chatWindow.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`);
        if (!el) return;
        el.classList.add('search-current');
        if (scroll) el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    }

    // Wraps each occurrence in the message's text nodes in a <mark>, leaving
    // the formatting (dialogue colour, italics, links) around it intact.
    function markSearchHits(messageId, query) {
        if (!query) return;
        const content = chatWindow.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"] > .main-content`);
        if (!content) return;
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        for (const node of textNodes) {
            const text = node.nodeValue;
            const lower = text.toLowerCase();
            let at = lower.indexOf(query);
            if (at === -1) continue;
            const fragment = document.createDocumentFragment();
            let from = 0;
            while (at !== -1) {
                fragment.appendChild(document.createTextNode(text.slice(from, at)));
                const mark = document.createElement('mark');
                mark.className = 'chat-search-hit';
                mark.textContent = text.slice(at, at + query.length);
                fragment.appendChild(mark);
                from = at + query.length;
                at = lower.indexOf(query, from);
            }
            fragment.appendChild(document.createTextNode(text.slice(from)));
            node.parentNode.replaceChild(fragment, node);
        }
    }

    function clearSearchMarks() {
        chatWindow.querySelectorAll('mark.chat-search-hit').forEach(mark => {
            const parent = mark.parentNode;
            if (!parent) return;
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        });
    }

    function searchSnippetHtml(text, query) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!query) return escapeHtml(clean.length > 140 ? `${clean.slice(0, 140)}…` : clean);
        const at = clean.toLowerCase().indexOf(query);
        if (at === -1) return escapeHtml(clean.slice(0, 140));
        const start = Math.max(0, at - 50);
        const end = Math.min(clean.length, at + query.length + 90);
        return `${start > 0 ? '…' : ''}${escapeHtml(clean.slice(start, at))}<mark>${escapeHtml(clean.slice(at, at + query.length))}</mark>${escapeHtml(clean.slice(at + query.length, end))}${end < clean.length ? '…' : ''}`;
    }

    function speakerLabel(message, ownerId) {
        if (message.sender === 'user') return 'You';
        if (message.type === 'story') return 'Narrator';
        return getCharacterDisplayName(characters[message.speakerId || ownerId]);
    }

    const CHAT_SEARCH_RESULT_LIMIT = 200;

    function renderAllChatsResults(query) {
        chatSearch.matches = [];
        chatSearch.index = -1;
        if (!chatSearchResults) return;
        chatSearchResults.innerHTML = '';
        const character = characters[currentCharacterId];
        if (!character || (!query && !chatSearch.bookmarksOnly)) {
            chatSearchResults.classList.add('hidden');
            if (chatSearchCount) chatSearchCount.textContent = '';
            return;
        }
        // Newest chats first, and the newest messages first inside each.
        const results = [];
        Object.values(character.chats || {})
            .sort((a, b) => String(b.id).localeCompare(String(a.id)))
            .forEach(chat => {
                const history = chat.history || [];
                for (let i = history.length - 1; i >= 0; i--) {
                    if (messageMatchesSearch(history[i], query)) results.push({ chat, message: history[i] });
                }
            });
        if (chatSearchCount) chatSearchCount.textContent = results.length ? `${results.length} found` : 'No results';
        if (!results.length) {
            chatSearchResults.classList.add('hidden');
            return;
        }
        results.slice(0, CHAT_SEARCH_RESULT_LIMIT).forEach(({ chat, message }) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'chat-search-result';
            item.dataset.chatId = chat.id;
            item.dataset.messageId = message.id;
            item.innerHTML = `<span class="chat-search-result-meta">${escapeHtml(chat.name || 'Chat')} · ${escapeHtml(speakerLabel(message, currentCharacterId))}${message.bookmarked ? ' ★' : ''}</span>`
                + `<span class="chat-search-result-snippet">${searchSnippetHtml(getMessageText(message), query)}</span>`;
            chatSearchResults.appendChild(item);
        });
        if (results.length > CHAT_SEARCH_RESULT_LIMIT) {
            const more = document.createElement('div');
            more.className = 'chat-search-results-more';
            more.textContent = `Showing the first ${CHAT_SEARCH_RESULT_LIMIT} matches. Type more to narrow them down.`;
            chatSearchResults.appendChild(more);
        }
        chatSearchResults.scrollTop = 0;
        chatSearchResults.classList.remove('hidden');
    }

    async function openSearchResult(chatId, messageId) {
        if (!characters[currentCharacterId]?.chats?.[chatId]) return;
        if (chatId !== currentChatId) await startChat(currentCharacterId, chatId);
        // From here on the search continues inside the chat that was opened.
        chatSearch.allChats = false;
        syncChatSearchControls();
        chatSearchResults?.classList.add('hidden');
        clearSearchMarks();
        const query = chatSearchQuery();
        collectChatMatches(query);
        chatSearch.index = Math.max(0, chatSearch.matches.indexOf(messageId));
        updateChatSearchCount(query);
        // After startChat has put back the saved scroll position.
        setTimeout(() => focusSearchMatch({ scroll: true, smooth: false }), 60);
    }

    chatSearchInput?.addEventListener('input', () => {
        clearTimeout(chatSearchTimer);
        chatSearchTimer = setTimeout(() => runChatSearch({ jump: true }), 160);
    });
    chatSearchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeChatSearch();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (chatSearch.allChats) {
                chatSearchResults?.querySelector('.chat-search-result')?.click();
            } else {
                stepChatSearch(event.shiftKey ? 1 : -1);
            }
        }
    });
    chatSearchScopeBtn?.addEventListener('click', () => {
        chatSearch.allChats = !chatSearch.allChats;
        syncChatSearchControls();
        runChatSearch({ jump: !chatSearch.allChats });
        chatSearchInput?.focus();
    });
    chatSearchBookmarksBtn?.addEventListener('click', () => {
        chatSearch.bookmarksOnly = !chatSearch.bookmarksOnly;
        syncChatSearchControls();
        runChatSearch({ jump: true });
        chatSearchInput?.focus();
    });
    chatSearchPrevBtn?.addEventListener('click', () => stepChatSearch(-1));
    chatSearchNextBtn?.addEventListener('click', () => stepChatSearch(1));
    document.getElementById('chat-search-close-btn')?.addEventListener('click', closeChatSearch);
    chatSearchResults?.addEventListener('click', (event) => {
        const result = event.target.closest('.chat-search-result');
        if (result) openSearchResult(result.dataset.chatId, result.dataset.messageId);
    });

    // ── Chat stats & milestones ──
    const chatStatsModal = document.getElementById('chat-stats-modal');

    function computeChatStats(chat) {
        const stats = { messages: 0, userMessages: 0, aiMessages: 0, words: 0, userWords: 0, aiWords: 0, images: 0, bookmarks: 0, hidden: 0 };
        for (const message of chat?.history || []) {
            if (isChatNoticeMessage(message)) continue;
            if (message.bookmarked === true) stats.bookmarks++;
            if (isHiddenFromAI(message)) stats.hidden++;
            const words = countWords(getMessageText(message));
            if (message.sender === 'user') {
                stats.userMessages++;
                stats.userWords += words;
            } else {
                stats.aiMessages++;
                stats.aiWords += words;
                stats.images += (message.variations || []).reduce((sum, v) => sum + (Array.isArray(v?.images) ? v.images.length : 0), 0);
            }
        }
        stats.messages = stats.userMessages + stats.aiMessages;
        stats.words = stats.userWords + stats.aiWords;
        // Chat ids are "chat-" plus the time the chat was started.
        const startedAt = parseInt(String(chat?.id || '').replace(/^chat-/, ''), 10);
        stats.startedAt = Number.isFinite(startedAt) && startedAt > 1e12 ? startedAt : null;
        stats.cost = Number(chat?.costUsd) || 0;
        return stats;
    }

    function formatCompactNumber(n) {
        if (n >= 1000000) return `${n / 1000000}M`;
        if (n >= 1000) return `${n / 1000}k`;
        return String(n);
    }

    function milestoneLabel(key) {
        const n = parseInt(key.slice(1), 10);
        return key[0] === 'm' ? `💬 ${formatCompactNumber(n)} messages` : `✍️ ${formatCompactNumber(n)} words`;
    }

    function daysAgoLabel(timestamp) {
        const days = Math.floor((Date.now() - timestamp) / 86400000);
        if (days <= 0) return 'today';
        return days === 1 ? '1 day ago' : `${days.toLocaleString('en-US')} days ago`;
    }

    function openChatStats() {
        const character = characters[currentCharacterId];
        const chat = getCurrentChat();
        if (!character || !chat || !chatStatsModal) return;
        const stats = computeChatStats(chat);
        const fmt = n => n.toLocaleString('en-US');
        document.getElementById('chat-stats-subtitle').textContent = `${chat.name || 'This chat'} · with ${getCharacterDisplayName(character)}`;

        const tiles = [
            ['💬', 'Messages', fmt(stats.messages), `You ${fmt(stats.userMessages)} · AI ${fmt(stats.aiMessages)}`],
            ['✍️', 'Words', fmt(stats.words), `You ${fmt(stats.userWords)} · AI ${fmt(stats.aiWords)}`],
            ['📅', 'Started', stats.startedAt ? new Date(stats.startedAt).toLocaleDateString() : '-', stats.startedAt ? daysAgoLabel(stats.startedAt) : ''],
            ['★', 'Bookmarks', fmt(stats.bookmarks), stats.hidden ? `${fmt(stats.hidden)} hidden from AI` : ''],
            ['🎨', 'Images', fmt(stats.images), ''],
            ['💲', 'Cost', stats.cost > 0 ? formatUsd(stats.cost) : '-',
                (stats.cost > 0 || sessionCostUsd > 0) ? `${formatUsd(sessionCostUsd)} this session` : 'Shown for OpenRouter models']
        ];
        document.getElementById('chat-stats-grid').innerHTML = tiles.map(([icon, label, value, sub]) => `
            <div class="chat-stat-tile">
                <span class="chat-stat-label"><span aria-hidden="true">${icon}</span> ${escapeHtml(label)}</span>
                <span class="chat-stat-value">${escapeHtml(value)}</span>
                ${sub ? `<span class="chat-stat-sub">${escapeHtml(sub)}</span>` : ''}
            </div>`).join('');

        const reached = reachedMilestones(stats.messages, stats.words);
        const nextMessages = MESSAGE_MILESTONES.find(n => n > stats.messages);
        const previousMessages = [...MESSAGE_MILESTONES].reverse().find(n => n <= stats.messages) || 0;
        const progress = nextMessages ? Math.round(((stats.messages - previousMessages) / (nextMessages - previousMessages)) * 100) : 100;
        document.getElementById('chat-stats-milestones').innerHTML = `
            <div class="milestones-title">🏆 Milestones</div>
            ${reached.length
                ? `<div class="milestone-badges">${reached.map(key => `<span class="milestone-badge">${milestoneLabel(key)}</span>`).join('')}</div>`
                : '<p class="milestones-empty">None yet. The first one is waiting at 25 messages.</p>'}
            ${nextMessages ? `
            <div class="milestone-next">
                <span>Next: ${fmt(nextMessages)} messages <span class="milestone-next-count">(${fmt(stats.messages)}/${fmt(nextMessages)})</span></span>
                <div class="milestone-bar"><div class="milestone-bar-fill" style="width:${progress}%"></div></div>
            </div>` : ''}`;
        chatStatsModal.classList.remove('hidden');
        document.getElementById('close-chat-stats-btn')?.focus();
    }

    function closeChatStats() {
        chatStatsModal?.classList.add('hidden');
    }

    document.getElementById('close-chat-stats-btn')?.addEventListener('click', closeChatStats);
    chatStatsModal?.addEventListener('click', (event) => { if (event.target === chatStatsModal) closeChatStats(); });

    function checkChatMilestones(character, chat) {
        if (!character || !chat) return;
        const stats = computeChatStats(chat);
        const reached = reachedMilestones(stats.messages, stats.words);
        if (!Array.isArray(chat.milestones)) {
            // A chat from before milestones existed has what it already
            // reached recorded quietly, instead of celebrated all at once.
            chat.milestones = reached;
            return;
        }
        const fresh = reached.filter(key => !chat.milestones.includes(key));
        if (!fresh.length) return;
        chat.milestones.push(...fresh);
        saveSingleCharacterToDB(character).catch(err => console.error('Could not save the milestone:', err));
        if (chat !== getCurrentChat()) return;
        const key = fresh[fresh.length - 1];
        const n = parseInt(key.slice(1), 10).toLocaleString('en-US');
        const name = getCharacterDisplayName(character);
        showChatToast(key[0] === 'm'
            ? `🎉 ${n} messages with ${name}!`
            : `📚 ${n} words written together with ${name}!`);
        // A beat after the reply sound, so the two do not blur together.
        playSound('milestone', { delayMs: 450 });
    }

    // Everything that follows a finished reply, whichever way it was asked for.
    function afterAIReply(character, chat) {
        if (!character || !chat) return;
        checkChatMilestones(character, chat);
        maybeAutoSummarize(character, chat);
        maybeAutoAtmosphere(character, chat);
    }

    // ── Automatic summaries ──
    const SUMMARY_SYSTEM_PROMPT = `You are a concise summarization assistant. Summarize the key story events, facts, and character developments from a roleplay chat. Output only 5-10 bullet points. No intro, no outro, no markdown headers.`;
    // A round starts once this many messages are waiting beyond the newest few,
    const AUTO_SUMMARY_CHUNK = 40;
    // which are left for the next round while the scene is still unfolding.
    const AUTO_SUMMARY_KEEP_RECENT = 10;
    // Switched on in a long chat, only its latest stretch is summarized.
    const AUTO_SUMMARY_MAX_WINDOW = 80;
    let autoSummaryRunning = false;

    function buildSummaryTranscript(messages, ownerId) {
        return messages.map(msg => {
            if (msg.sender === 'user') return `User: ${msg.main || ''}`;
            const text = msg.variations?.[msg.activeVariant]?.main || '';
            if (msg.type === 'story') return `Narrator: ${text}`;
            const charName = characters[msg.speakerId || ownerId]?.chatName || 'Character';
            return `${charName}: ${text}`;
        }).join('\n\n');
    }

    async function maybeAutoSummarize(character, chat) {
        if (!autoSummarizeEnabled || autoSummaryRunning || !character || !Array.isArray(chat?.history)) return;
        const end = chat.history.length - AUTO_SUMMARY_KEEP_RECENT;
        let start;
        if (chat.summarizedUpToId) {
            const index = chat.history.findIndex(m => m.id === chat.summarizedUpToId);
            // Gone means the chat was cut back past it: all that is left was covered.
            start = index === -1 ? chat.history.length : index + 1;
        } else {
            start = Math.max(0, end - AUTO_SUMMARY_MAX_WINDOW);
        }
        if (end - start < AUTO_SUMMARY_CHUNK) return;
        const upToId = chat.history[end - 1].id;
        const messages = historyForPrompt(chat.history.slice(start, end));
        autoSummaryRunning = true;
        try {
            if (messages.length >= 6) {
                const ownerId = Object.keys(characters).find(id => characters[id] === character) || currentCharacterId;
                const summary = String(await callAISimple(
                    SUMMARY_SYSTEM_PROMPT,
                    `Summarize the key events and facts from this part of a roleplay conversation:\n\n${buildSummaryTranscript(messages, ownerId)}`,
                    suggestionModelId || modelSelect?.value || defaultSettings.model,
                    null,
                    'none',
                    { chat }
                ) || '').trim();
                if (!summary) return;
                const existing = getChatMemories(chat);
                const block = `--- Auto-summary (${new Date().toLocaleDateString()}) ---\n${summary}`;
                chat.memories = existing ? `${existing}\n\n${block}` : block;
                delete chat.storyLine;
                delete chat.plan;
            }
            chat.summarizedUpToId = upToId;
            await saveSingleCharacterToDB(character);
            if (chat === getCurrentChat()) {
                updateChatMemoriesButtonState();
                updateTokenCount();
                if (messages.length >= 6) {
                    showChatToast('🧠 Older messages were summarized into Chat Memories.');
                    playSound('memory');
                }
            }
        } catch (err) {
            console.warn('Auto-summary failed:', err);
        } finally {
            autoSummaryRunning = false;
        }
    }

    const autoSummarizeToggle = document.getElementById('auto-summarize-toggle');
    if (autoSummarizeToggle) addSettingListener(autoSummarizeToggle, 'autoSummarize', 'change');

    // ── Let Them Talk ──
    const autoPlayStatus = document.getElementById('autoplay-status');
    const autoPlayStatusText = document.getElementById('autoplay-status-text');

    // The characters who can take a turn: everyone but the world card.
    function getSpeakingParticipants(chat) {
        return (chat?.participants || []).filter(pid => characters[pid] && characters[pid].type !== 'world');
    }

    function renderAutoPlayStatus(turn, total, speakerId) {
        if (!autoPlayStatus) return;
        if (!autoPlayState.running) {
            autoPlayStatus.classList.add('hidden');
            return;
        }
        const speaker = characters[speakerId];
        autoPlayStatusText.textContent = `Turn ${turn} of ${total}${speaker ? ` · ${getCharacterDisplayName(speaker)} is replying` : ''}`;
        autoPlayStatus.classList.remove('hidden');
    }

    async function startAutoPlay() {
        const character = characters[currentCharacterId];
        const chat = getCurrentChat();
        if (!character || !chat || autoPlayState.running) return;
        if (chatTurnInProgress || currentStreamController) {
            showChatToast('Wait until the current reply has finished.');
            return;
        }
        if (getSpeakingParticipants(chat).length < 2) {
            showCustomAlert('Add at least two characters to this chat with 👥 to let them talk to each other.');
            return;
        }
        const turns = await showChoiceDialog('Let the characters talk among themselves. How many turns?', [
            { label: 'Cancel', value: 0 },
            { label: '4 turns', value: 4 },
            { label: '8 turns', value: 8, primary: true },
            { label: '12 turns', value: 12 }
        ]);
        if (!turns || getCurrentChat() !== chat) return;

        const charId = currentCharacterId;
        const chatId = currentChatId;
        const previousTag = activeGroupParticipantId;
        autoPlayState.running = true;
        autoPlayState.stopRequested = false;
        autoPlayState.chatId = chatId;
        cancelReplyOptions();
        const lastReply = [...chat.history].reverse().find(m => m.sender === 'ai' && m.type !== 'story');
        let lastSpeakerId = lastReply ? (lastReply.speakerId || charId) : null;
        try {
            for (let turn = 1; turn <= turns; turn++) {
                if (autoPlayState.stopRequested || currentCharacterId !== charId || currentChatId !== chatId) break;
                const speakers = getSpeakingParticipants(chat);
                if (speakers.length < 2) break;
                const candidates = speakers.filter(id => id !== lastSpeakerId);
                const nextId = candidates[Math.floor(diceRandom() * candidates.length)];
                renderAutoPlayStatus(turn, turns, nextId);
                activeGroupParticipantId = nextId;
                await handleChatSubmit('dialog', { autoTurn: true });
                const last = chat.history[chat.history.length - 1];
                if (!last || last.sender !== 'ai' || isChatNoticeMessage(last)) break;
                lastSpeakerId = last.speakerId || nextId;
            }
        } finally {
            autoPlayState.running = false;
            autoPlayState.stopRequested = false;
            autoPlayState.chatId = null;
            renderAutoPlayStatus();
            if (currentCharacterId === charId && currentChatId === chatId) {
                // The user's own tag, if they had one, is theirs again.
                activeGroupParticipantId = previousTag && chat.participants?.includes(previousTag) ? previousTag : null;
                updateChatReplyControls();
                generateReplyOptionsInBackground();
            }
        }
    }

    function stopAutoPlay() {
        if (!autoPlayState.running) return;
        autoPlayState.stopRequested = true;
        if (autoPlayStatusText) autoPlayStatusText.textContent = 'Stopping…';
        if (currentStreamController) stopStreamBtn.click();
    }

    document.getElementById('autoplay-stop-btn')?.addEventListener('click', stopAutoPlay);
    stopStreamBtn.addEventListener('click', () => {
        if (autoPlayState.running) autoPlayState.stopRequested = true;
    });

    // ── Automatic atmosphere ──
    let atmosphereRequestId = 0;

    // The effect a chat shows: the scene's own pick while the automatic
    // atmosphere is on, otherwise the one chosen for the character.
    function getEffectiveParticleEffect(character, chat) {
        if (autoAtmosphereEnabled && typeof chat?.sceneEffect === 'string' && PARTICLE_EMOJIS[chat.sceneEffect]) {
            return chat.sceneEffect;
        }
        return character?.particleEffect || 'none';
    }

    async function maybeAutoAtmosphere(character, chat) {
        if (!autoAtmosphereEnabled || !character || !chat) return;
        const lastReply = [...historyForPrompt(chat.history)].reverse().find(m => m.sender === 'ai');
        const scene = getMessageText(lastReply).trim();
        if (!scene) return;
        const requestId = ++atmosphereRequestId;
        const subject = character.type === 'world' ? 'the scene' : getCharacterDisplayName(character);
        const effects = Object.keys(PARTICLE_EMOJIS);
        const moods = Object.keys(CCC_MOOD_DEFINITIONS);
        const system = `You set the ambience of a roleplay chat from its latest scene. Choose:
- "effect": exactly one of ${effects.join(', ')}. Pick what the scene's place and moment suggest: rain in a storm, snow in winter, fireflies on a summer night, sparks near fire or battle, darkness for dread, fog for mystery, sakura for spring romance. Use "none" when nothing fits, such as an ordinary indoor conversation.
- "mood": exactly one of ${moods.join(', ')}, or "none". It is the current emotional state of ${subject}.
Reply with JSON only, for example {"effect":"rain","mood":"Sad"}.`;
        try {
            const raw = await callAISimple(
                system,
                `Latest scene:\n${scene.slice(-1500)}`,
                suggestionModelId || modelSelect?.value || defaultSettings.model,
                null,
                'none',
                { chat }
            );
            if (requestId !== atmosphereRequestId || !autoAtmosphereEnabled) return;
            const json = String(raw || '').match(/\{[\s\S]*?\}/);
            if (!json) return;
            const picked = JSON.parse(json[0]);
            const effect = typeof picked.effect === 'string' ? picked.effect.trim().toLowerCase() : '';
            const moodText = typeof picked.mood === 'string' ? picked.mood.trim() : '';
            let effectChanged = false;
            let moodChanged = false;
            if (PARTICLE_EMOJIS[effect] && chat.sceneEffect !== effect) {
                chat.sceneEffect = effect;
                effectChanged = true;
            }
            const mood = moodText.toLowerCase() === 'none' ? null : normalizeMood(moodText);
            if ((mood || moodText.toLowerCase() === 'none') && mood !== normalizeMood(chat.mood)) {
                chat.mood = mood;
                moodChanged = true;
            }
            if (!effectChanged && !moodChanged) return;
            await saveSingleCharacterToDB(character);
            if (chat !== getCurrentChat() || !isChatScreenActive()) return;
            if (effectChanged) startParticles(getEffectiveParticleEffect(character, chat), fxSavedLevels(character));
            updateParticleButton();
            updateMoodButton();
        } catch (err) {
            console.warn('Automatic atmosphere failed:', err);
        }
    }

    // Called by applySetting whenever the setting actually changes.
    function onAutoAtmosphereToggled() {
        const character = characters[currentCharacterId];
        const chat = getCurrentChat();
        if (!character || !chat || !isChatScreenActive()) return;
        const effect = getEffectiveParticleEffect(character, chat);
        startParticles(effect, fxSavedLevels(character));
        updateParticleButton();
        particlePickerModal?.querySelectorAll('.particle-option-btn').forEach(b => b.classList.toggle('active', b.dataset.effect === effect));
        particleSettingsRow?.classList.toggle('hidden', effect === 'none');
        if (autoAtmosphereEnabled) maybeAutoAtmosphere(character, chat);
    }

    const autoAtmosphereToggle = document.getElementById('auto-atmosphere-toggle');
    if (autoAtmosphereToggle) addSettingListener(autoAtmosphereToggle, 'autoAtmosphere', 'change');

    // ── Unsent drafts ──
    function chatDraftKey(charId, chatId) {
        return `chatDraft:${charId}:${chatId}`;
    }
    let chatDraftTimer = null;
    // The chat the pending save belongs to, fixed when the typing happened.
    let chatDraftOwner = null;

    function saveChatDraftNow() {
        clearTimeout(chatDraftTimer);
        chatDraftTimer = null;
        if (!chatDraftOwner) return;
        const key = chatDraftKey(chatDraftOwner.charId, chatDraftOwner.chatId);
        chatDraftOwner = null;
        const value = messageInput.value;
        try {
            if (value.trim()) localStorage.setItem(key, value);
            else localStorage.removeItem(key);
        } catch (_) {}
    }

    function scheduleChatDraftSave() {
        if (!currentCharacterId || !currentChatId) return;
        chatDraftOwner = { charId: currentCharacterId, chatId: currentChatId };
        clearTimeout(chatDraftTimer);
        chatDraftTimer = setTimeout(saveChatDraftNow, 400);
    }

    function loadChatDraft(charId, chatId) {
        saveChatDraftNow();
        stopVoiceInput({ discard: true });
        let draft = '';
        try { draft = localStorage.getItem(chatDraftKey(charId, chatId)) || ''; } catch (_) {}
        messageInput.value = draft;
        autoResizeTextarea({ target: messageInput });
    }

    function clearChatDraft() {
        clearTimeout(chatDraftTimer);
        chatDraftTimer = null;
        chatDraftOwner = null;
        if (!currentCharacterId || !currentChatId) return;
        try { localStorage.removeItem(chatDraftKey(currentCharacterId, currentChatId)); } catch (_) {}
    }

    messageInput.addEventListener('input', scheduleChatDraftSave);
    window.addEventListener('pagehide', saveChatDraftNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveChatDraftNow(); });

    // ── Voice input ──
    const voiceInputBtn = document.getElementById('voice-input-btn');
    const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    const messageInputPlaceholder = messageInput.placeholder;
    let voiceRecognition = null;
    // Firefox has no speech recognition, so the button only appears where it works.
    if (SpeechRecognitionApi && voiceInputBtn) voiceInputBtn.classList.remove('hidden');

    function setVoiceListening(listening) {
        if (!voiceInputBtn) return;
        voiceInputBtn.classList.toggle('is-listening', listening);
        voiceInputBtn.setAttribute('aria-pressed', String(listening));
        voiceInputBtn.title = listening ? 'Stop voice input' : 'Voice input';
        voiceInputBtn.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
        messageInput.placeholder = listening ? 'Listening... speak now' : messageInputPlaceholder;
    }

    // `discard` drops what the browser has not delivered yet: after a send
    // or a chat switch, late words would otherwise land in the emptied box.
    // A plain stop keeps them - that is the user finishing a sentence.
    function stopVoiceInput({ discard = false } = {}) {
        if (!voiceRecognition) return;
        const recognition = voiceRecognition;
        voiceRecognition = null;
        if (discard) {
            recognition.onresult = null;
            try { recognition.abort(); } catch (_) {}
        } else {
            try { recognition.stop(); } catch (_) {}
        }
        setVoiceListening(false);
    }

    function startVoiceInput() {
        if (!SpeechRecognitionApi || voiceRecognition) return;
        const recognition = new SpeechRecognitionApi();
        recognition.lang = navigator.language || 'en-US';
        recognition.interimResults = true;
        recognition.continuous = true;
        // Speech is added after what is already typed, and rewritten as the
        // browser firms up its guesses.
        const typedBefore = messageInput.value.replace(/\s+$/, '');
        recognition.onresult = (event) => {
            let spoken = '';
            for (let i = 0; i < event.results.length; i++) spoken += event.results[i][0].transcript;
            spoken = spoken.trim();
            messageInput.value = typedBefore && spoken ? `${typedBefore} ${spoken}` : (typedBefore || spoken);
            autoResizeTextarea({ target: messageInput });
            scheduleChatDraftSave();
        };
        recognition.onerror = (event) => {
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                showChatToast('🎤 Microphone access is blocked. Allow it for this site to use voice input.');
            } else if (event.error === 'network') {
                showChatToast('🎤 Voice input needs an internet connection in this browser.');
            } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
                showChatToast(`🎤 Voice input stopped (${event.error}).`);
            }
        };
        recognition.onend = () => {
            if (voiceRecognition !== recognition) return;
            voiceRecognition = null;
            setVoiceListening(false);
        };
        try {
            recognition.start();
        } catch (_) {
            showChatToast('🎤 Voice input could not start.');
            return;
        }
        voiceRecognition = recognition;
        setVoiceListening(true);
    }

    voiceInputBtn?.addEventListener('click', () => {
        if (voiceRecognition) stopVoiceInput();
        else startVoiceInput();
    });

    // ── Leaving the chat ──
    backToSelectionBtn.addEventListener('click', () => {
        stopAutoPlay();
        stopVoiceInput({ discard: true });
        saveChatDraftNow();
        closeChatSearch();
        closeChatMenu();
        closeMessageMenu();
    });

    // ── Keyboard shortcuts ──
    const shortcutsModal = document.getElementById('shortcuts-modal');

    function openShortcuts() {
        shortcutsModal?.classList.remove('hidden');
        document.getElementById('close-shortcuts-btn')?.focus();
    }

    function closeShortcuts() {
        shortcutsModal?.classList.add('hidden');
    }

    document.getElementById('close-shortcuts-btn')?.addEventListener('click', closeShortcuts);
    shortcutsModal?.addEventListener('click', (event) => { if (event.target === shortcutsModal) closeShortcuts(); });

    const DIALOG_IDS = [
        'character-editor-modal', 'message-editor-modal', 'chat-memories-modal', 'scenario-selection-modal',
        'participant-selection-modal', 'persona-selection-modal', 'quick-swap-modal', 'move-chat-modal',
        'particle-picker-modal', 'persona-list-modal', 'persona-editor-modal', 'app-settings-modal',
        'image-crop-modal', 'gallery-action-modal', 'chat-stats-modal', 'shortcuts-modal'
    ];

    function isAnyDialogOpen() {
        if (document.querySelector('.custom-alert-overlay')) return true;
        if (document.getElementById('tutorial-backdrop')?.classList.contains('tutorial-active')) return true;
        return DIALOG_IDS.some(id => {
            const el = document.getElementById(id);
            return !!el && !el.classList.contains('hidden');
        });
    }

    // Registered for the capture phase, so it sees a key before the dialog it
    // belongs to closes itself - Escape in a dialog must never also stop a reply.
    document.addEventListener('keydown', (event) => {
        if (typeof event.key !== 'string') return;
        if (event.key === 'Escape') {
            if (messageMenu && !messageMenu.classList.contains('hidden')) { closeMessageMenu(); return; }
            if (chatMenu && !chatMenu.classList.contains('hidden')) { closeChatMenu(); chatMenuBtn?.focus(); return; }
            if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) { closeShortcuts(); return; }
            if (chatStatsModal && !chatStatsModal.classList.contains('hidden')) { closeChatStats(); return; }
            if (!isChatScreenActive() || isAnyDialogOpen()) return;
            if (chatSearch.open) {
                event.preventDefault();
                closeChatSearch();
                return;
            }
            if (currentStreamController || autoPlayState.running) {
                event.preventDefault();
                stopAutoPlay();
                stopStreamBtn.click();
            }
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (!isChatScreenActive() || isKeyboardInputFocused() || isAnyDialogOpen()) return;
        if (event.key === '?') {
            event.preventDefault();
            openShortcuts();
        } else if (event.key === '/') {
            event.preventDefault();
            openChatSearch();
        }
    }, true);

    // ── Install as an app ──
    // Browsers that can install the app announce it with this event; the
    // button only appears then. The address bar's own install icon still works.
    const installAppBtn = document.getElementById('install-app-btn');
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        installAppBtn?.classList.remove('hidden');
    });
    installAppBtn?.addEventListener('click', async () => {
        const installPrompt = deferredInstallPrompt;
        if (!installPrompt) return;
        deferredInstallPrompt = null;
        installAppBtn.classList.add('hidden');
        try {
            await installPrompt.prompt();
            await installPrompt.userChoice;
        } catch (_) {}
    });
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        installAppBtn?.classList.add('hidden');
    });

    // ── The phone's Back button ──
    // An installed app has no history of its own, so Back used to close it
    // from any screen. Now each Back does what the app's own close, cancel or
    // back button would, and only on the main screen, with nothing open, does
    // Back go on to close the app.
    //
    // Back is caught with a CloseWatcher, which Android's Back (button or
    // swipe) fires. History entries cannot do it: Chrome's Back skips any entry
    // a page adds without a fresh tap, and a tap within a few seconds of the
    // last one is not fresh - so the second Back in a row closed the app. A
    // CloseWatcher may be set up again straight after Back without a tap.
    // Browsers without CloseWatcher get the history entry, which covers at
    // least one Back after each tap.
    //
    // Installed app only. In a browser tab, Back keeps meaning "leave the page".
    const BACK_GUARD_KEY = 'cccBackGuard';
    const backGuardEnabled = window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches
        || navigator.standalone === true;

    function isShown(el) {
        return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
    }

    // Topmost first, so Back closes the dialog that was opened last.
    const BACK_CLOSES_DIALOG = [
        ['gallery-action-modal', 'gallery-action-cancel-btn'],
        ['image-crop-modal', 'image-crop-cancel-btn'],
        ['worldCharPickerModal', 'worldCharPickerCancelBtn'],
        ['bulkCharDeleteModal', 'cancel-bulk-delete-btn'],
        ['persona-editor-modal', 'cancel-persona-edit-btn'],
        ['persona-list-modal', 'close-persona-list-btn'],
        ['persona-selection-modal', 'cancel-persona-select-btn'],
        ['participant-selection-modal', 'cancel-participant-selection-btn'],
        ['scenario-selection-modal', 'cancel-scenario-selection-btn'],
        ['quick-swap-modal', 'cancel-quick-swap-btn'],
        ['move-chat-modal', 'cancel-move-chat-btn'],
        ['particle-picker-modal', 'close-particle-picker-btn'],
        ['chat-stats-modal', 'close-chat-stats-btn'],
        ['shortcuts-modal', 'close-shortcuts-btn'],
        ['message-editor-modal', 'cancel-message-edit-btn'],
        ['chat-memories-modal', 'cancel-memories-edit-btn'],
        ['app-settings-modal', 'cancel-app-settings-btn'],
        ['character-editor-modal', 'cancel-edit-btn-top']
    ];

    // Does one step of going back. Returns false only on the main screen with
    // nothing open, where there is nothing left in the app to go back from.
    function goBackInApp() {
        if (document.getElementById('tutorial-backdrop')?.classList.contains('tutorial-active')) {
            document.getElementById('tutorial-skip-btn')?.click();
            return true;
        }
        // Alerts, confirms and prompts: Cancel, or the only button there is.
        // A choice with no Cancel stays open until it is answered.
        const overlays = document.querySelectorAll('.custom-alert-overlay');
        if (overlays.length) {
            const buttons = [...overlays[overlays.length - 1].querySelectorAll('button')];
            const cancel = buttons.find(b => b.textContent.trim() === 'Cancel') || (buttons.length === 1 ? buttons[0] : null);
            cancel?.click();
            return true;
        }
        const dice = document.querySelector('.dice-roll-overlay:not(.leaving)');
        if (dice) { dice.click(); return true; }

        for (const [dialogId, buttonId] of BACK_CLOSES_DIALOG) {
            if (isShown(document.getElementById(dialogId))) {
                document.getElementById(buttonId)?.click();
                return true;
            }
        }

        if (isShown(messageMenu)) { closeMessageMenu(); return true; }
        if (isShown(chatMenu)) { closeChatMenu(); return true; }
        const moodPicker = document.getElementById('mood-picker');
        if (isShown(moodPicker)) {
            moodPicker.classList.add('hidden');
            document.getElementById('mood-btn')?.setAttribute('aria-expanded', 'false');
            return true;
        }
        const musicPanel = document.getElementById('music-panel');
        if (isShown(musicPanel)) { musicPanel.classList.add('hidden'); return true; }
        if (isShown(settingsPanel)) { settingsPanel.classList.add('hidden'); return true; }
        if (isChatScreenActive() && chatSearch.open) { closeChatSearch(); return true; }

        if (isChatScreenActive()) { backToSelectionBtn.click(); return true; }
        if (!chatListScreen.classList.contains('is-inactive')) {
            if (isShown(document.getElementById('chat-group-bar'))) exitChatGroupBtn?.click();
            else backToMainBtn.click();
            return true;
        }
        return false;
    }

    const BACK_AGAIN_TO_CLOSE = 'Press Back again to close the app.';

    if (backGuardEnabled && typeof window.CloseWatcher === 'function') {
        // A keyboard's Escape fires the watcher too. The app already handles
        // Escape itself, so a close that follows one is left to that handling.
        let escapePressedAt = -Infinity;
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') escapePressedAt = performance.now();
        }, true);

        let backWatcher = null;
        const watchBack = () => {
            if (backWatcher) return;
            backWatcher = new CloseWatcher();
            backWatcher.addEventListener('close', () => {
                backWatcher = null;
                if (performance.now() - escapePressedAt < 500 || goBackInApp()) {
                    watchBack();
                    return;
                }
                // Main screen, nothing open: no watcher, so the next Back
                // closes the app - unless a tap comes first.
                showChatToast(BACK_AGAIN_TO_CLOSE);
            });
        };
        watchBack();
        document.addEventListener('click', (event) => { if (event.isTrusted) watchBack(); }, true);
    } else if (backGuardEnabled) {
        let backGuardArmed = history.state?.[BACK_GUARD_KEY] === true;
        const armBackGuard = () => {
            if (backGuardArmed) return;
            history.pushState({ [BACK_GUARD_KEY]: true }, '');
            backGuardArmed = true;
        };
        // Only real input counts; the buttons goBackInApp clicks are not.
        document.addEventListener('click', (event) => { if (event.isTrusted) armBackGuard(); }, true);
        window.addEventListener('popstate', (event) => {
            // Forward onto the guard entry again, not Back.
            if (event.state?.[BACK_GUARD_KEY]) { backGuardArmed = true; return; }
            backGuardArmed = false;
            if (goBackInApp()) armBackGuard();
            else showChatToast(BACK_AGAIN_TO_CLOSE);
        });
    }

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
// Kept rather than fired and forgotten: the Character Card Browser bridge has to wait
// for the database and the collection before it can accept a card, and this is
// the only handle on "the app has finished coming up".
const appReady = initializeApp();



function adjustCardImageFit() {
    const cardImages = document.querySelectorAll('.card-image-container img');
    cardImages.forEach(img => {
        const checkAndSetFit = (imageElement) => {
            const isPortrait = imageElement.naturalWidth < imageElement.naturalHeight;

            if (isPortrait) {
                imageElement.style.objectFit = 'contain';
                imageElement.parentElement.style.backgroundColor = 'rgba(0,0,0,0.5)';
                imageElement.parentElement.classList.add('has-contain-img');
            } else {
                imageElement.style.objectFit = 'cover';
                imageElement.parentElement.style.backgroundColor = '';
                imageElement.parentElement.classList.remove('has-contain-img');
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
            if (starterAppSettings) {
                console.log('First launch: Loading app settings from starter pack...');
                const starterModels = Array.isArray(starterAppSettings.availableModels)
                    ? starterAppSettings.availableModels.filter(m => m && m.id).map(m => ({ ...m }))
                    : [];

                // An API key typed before any character existed belongs to the
                // user, not to the pack.
                appSettings = {
                    ...starterAppSettings,
                    availableModels: starterModels,
                    apiKey: (appSettings && appSettings.apiKey) || starterAppSettings.apiKey || ''
                };

                if (db) {
                    const transaction = db.transaction(['settings'], 'readwrite');
                    const store = transaction.objectStore('settings');
                    store.put({ key: 'appSettings', value: appSettings });
                }

                // The settings list and the selector were already built from the
                // first-run defaults by the time this runs, so the pack has to be
                // pushed into them here; otherwise its models only showed up
                // after a reload.
                if (starterModels.length > 0) {
                    modelListContainer.innerHTML = '';
                    starterModels.forEach(model => createModelEntry(model));
                    populateModelSelector();
                    setSelectValueWithFallback(modelSelect, [resolveDefaultModelId(starterModels)]);
                }
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
    window.dispatchEvent(new Event('resize'));
});

document.addEventListener('keydown', (event) => {
    // Plain F only. Ctrl+F / Cmd+F is the browser's Find and must reach it;
    // autofill can also dispatch a keydown without a key at all.
    if (typeof event.key !== 'string' || event.ctrlKey || event.metaKey || event.altKey) return;
    const focused = document.activeElement;
    if (event.key.toLowerCase() === 'f' &&
        focused && focused.tagName !== 'INPUT' &&
        focused.tagName !== 'TEXTAREA' && focused.tagName !== 'SELECT' && !focused.isContentEditable) {
        
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
        editorAvatarContainer.style.backgroundImage = cssUrl(url);
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
        chatListScreenForPreview.style.backgroundImage = cssUrl(url);
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

if (!localStorage.getItem('hasSeenHelpNotification')) {
    helpDot.classList.remove('hidden');
}

helpBtn.addEventListener('click', () => {
    if (!localStorage.getItem('hasSeenHelpNotification')) {
        localStorage.setItem('hasSeenHelpNotification', 'true');
    }
    helpDot.classList.add('hidden');
});


// =============================================================
// TUTORIAL TOUR MODULE
// =============================================================

// Three self-contained tours, one per screen. Each one starts the first time
// its screen is reached and finishes on that same screen. The previous version
// was a single step list split across all three screens, so it kept breaking
// off mid-tour and waiting for the user to navigate — separate tours per screen
// are short, and nothing is left hanging.
//
// Ending a tour marks only that tour seen, whether it was walked to the end or
// skipped. Skipping the main menu tour still leaves the chat list and chat tours
// to start on their own screens, and each of those is skipped separately.
const tutorialTours = {
    'character-selection': {
        storageKey: 'tourSeenMain',
        label: 'Main Menu',
        steps: [
            {
                targetId: null,
                position: 'center',
                indicator: 'Welcome',
                title: 'Welcome to Casual Character Chat!',
                text: "Here's a quick tour of the main menu and how to start. Feel free to skip anytime.",
                nextLabel: "Let's Go",
            },
            {
                targetId: 'app-settings-btn',
                position: 'bottom',
                title: 'Enter your API key first!',
                text: 'Enter your API key here to be able to chat, ideally one from OpenRouter. Some AI models are already prepared there, but you can add your own.',
            },
            {
                targetId: 'new-character-btn',
                position: 'bottom',
                title: 'Create your own character',
                text: "You can freely create your own characters to chat with and edit them anytime. They stay always privately on your computer.",
            },
            {
                targetId: 'get-cards-btn',
                position: 'bottom',
                title: 'Browse characters online',
                text: 'Easily grab any characters from big roleplay platforms. You can import characters from there directly into this app with one click.',
            },
            {
                targetId: 'manage-personas-btn',
                position: 'bottom',
                title: 'Play as your own persona',
                text: 'You can create multiple personas for yourself if you want to roleplay as a specific protagonist.',
            },
            {
                targetId: 'export-btn',
                position: 'bottom',
                title: 'Your data lives in your browser',
                text: 'Nothing is stored on a server, so exporting your characters and chats is your backup! Even if you delete your data here, you can always re-upload your backup with "Import Data".',
            },
            {
                targetId: 'help-btn',
                position: 'top',
                title: 'Everything else is explained here',
                text: "Help & FAQ is always here whenever you need it. You can also send me a message if you run into any issues or have a request.",
                nextLabel: 'Done',
            },
        ],
    },
    'chat-list': {
        storageKey: 'tourSeenChatList',
        label: 'Chat List',
        steps: [
            {
                targetId: 'start-new-chat-btn',
                position: 'top',
                title: 'Start a new roleplay',
                text: 'You can either start an empty chat or select a prepared scenario (greeting). Every chat with this character is saved below.',
            },
            {
                targetId: 'new-chat-group-btn',
                position: 'bottom',
                title: 'Keep your chats organised',
                text: 'When your chat list grows, you can create groups and move chats into them. You can move those chats out again anytime.',
            },
            {
                targetId: 'edit-character-btn',
                position: 'top',
                title: 'Edit your character anytime',
                text: 'Freely edit the character, add scenarios, or change images here. "Copy Character" gives you a duplicate to experiment on.',
                nextLabel: 'Done',
            },
        ],
    },
    'chat': {
        storageKey: 'tourSeenChat',
        label: 'Chat',
        steps: [
            {
                targetId: 'chat-form',
                position: 'top',
                title: 'Type your message here',
                text: '"Character" sends your message and gets an AI reply. "Narrator" moves the story along instead. Try both!',
            },
            {
                targetId: 'settings-container',
                position: 'bottom',
                title: 'Your chat control panel',
                text: 'This row is per-chat: the ⋯ menu (search, bookmarks, stats, dice and more), mood, ambient effects, music, memories and story plan, group chat, and your persona.',
            },
            {
                targetId: 'settings-btn',
                position: 'bottom',
                title: "Chat settings and features",
                text: 'Customize your chat design, control AI models, get reply suggestions, or even use image generation - all in here.',
                nextLabel: 'Done',
            },
        ],
    },
};

// Written by the old single tour when it was completed or skipped; nothing sets
// it any more. Anyone carrying it has already been onboarded, so they are not
// shown the new tours.
const TUTORIAL_LEGACY_KEY = 'tutorialCompleted';

// Numbering the steps here rather than in the data keeps "Step 3 of 7" honest
// when steps are added or removed. Steps with their own indicator (the welcome
// card) sit outside the count.
Object.values(tutorialTours).forEach(tour => {
    const counted = tour.steps.filter(step => !step.indicator);
    counted.forEach((step, i) => {
        step.indicator = `${tour.label} · Step ${i + 1} of ${counted.length}`;
    });
    tour.steps.forEach(step => {
        if (!step.nextLabel) step.nextLabel = 'Next';
    });
});

const tutorialData = {
    active: false,
    tourName: null,
    currentStep: 0,
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

function tutorialCurrentSteps() {
    const tour = tutorialTours[tutorialData.tourName];
    return tour ? tour.steps : [];
}

function tutorialTourSeen(tourName) {
    if (localStorage.getItem(TUTORIAL_LEGACY_KEY)) return true;
    const tour = tutorialTours[tourName];
    return !tour || !!localStorage.getItem(tour.storageKey);
}

// A step whose target is missing or collapsed would leave a 0x0 spotlight and
// a tooltip floating in the corner, so those steps are stepped over instead.
function tutorialTargetUsable(step) {
    if (!step.targetId) return true;
    const el = document.getElementById(step.targetId);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

// The spotlight is position:fixed, so a target below the fold — the Help link
// sits under the whole character list — has to be scrolled into view first or
// the highlight lands off screen.
function tutorialRevealTarget(step) {
    if (!step.targetId) return;
    const el = document.getElementById(step.targetId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 90;
    if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
}

function tutorialFinish() {
    const tour = tutorialTours[tutorialData.tourName];
    if (tour) localStorage.setItem(tour.storageKey, 'true');
    tutorialData.active = false;
    tutorialData.tourName = null;
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
    const steps = tutorialCurrentSteps();
    while (stepIndex < steps.length && !tutorialTargetUsable(steps[stepIndex])) stepIndex++;

    if (stepIndex >= steps.length) {
        tutorialFinish();
        return;
    }

    const step = steps[stepIndex];
    tutorialData.currentStep = stepIndex;

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

    tutorialRevealTarget(step);
    tutorialReposition();

    requestAnimationFrame(() => {
        tutorialSpotlight.classList.add('tutorial-visible');
        tutorialTooltipEl.classList.add('tutorial-visible');
    });
}

// Re-measures the current step in place. Used on every step change and again
// whenever the page moves under the overlay (resize, scroll, on-screen keyboard).
function tutorialReposition() {
    const step = tutorialCurrentSteps()[tutorialData.currentStep];
    if (!step) return;
    const targetRect = tutorialPositionSpotlight(step);
    if (step.position === 'center') return;
    const pos = tutorialComputeTooltipPos(
        targetRect || { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 },
        step.position
    );
    tutorialTooltipEl.style.top  = pos.top  + 'px';
    tutorialTooltipEl.style.left = pos.left + 'px';
}

function tutorialStartTour(tourName) {
    if (tutorialData.active) return;
    if (!tutorialTours[tourName]) return;
    if (tutorialTourSeen(tourName)) return;
    tutorialData.active = true;
    tutorialData.tourName = tourName;
    tutorialShowStep(0);
}

// Called by each screen as it becomes visible. The swap animates, so the tour
// waits for it to land before measuring anything.
function tutorialOnScreenChange(screenName) {
    if (tutorialData.active) return;
    if (tutorialTourSeen(screenName)) return;
    setTimeout(() => {
        if (tutorialGetActivePhase() !== screenName) return;
        tutorialStartTour(screenName);
    }, 320);
}

function tutorialInit() {
    // Restoring a session may still be swapping screens, in which case that
    // screen announces itself through tutorialOnScreenChange instead.
    const currentPhase = tutorialGetActivePhase();
    if (currentPhase) tutorialStartTour(currentPhase);
}

tutorialSkipBtn.addEventListener('click', () => {
    tutorialFinish();
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
    if (!tutorialData.active) return;
    clearTimeout(tutorialResizeTimer);
    tutorialResizeTimer = setTimeout(tutorialReposition, 120);
});

// The backdrop swallows clicks but not the wheel, so the page can still slide
// out from under a highlight. Capture phase catches the inner scrollers too.
// The spotlight's 0.3s ease would trail the target the whole way down, so it
// tracks instantly while the scroll is running and gets its easing back after.
let tutorialScrollTimer;
window.addEventListener('scroll', () => {
    if (!tutorialData.active) return;
    tutorialSpotlight.style.transition = 'opacity 0.25s ease';
    tutorialReposition();
    clearTimeout(tutorialScrollTimer);
    tutorialScrollTimer = setTimeout(() => {
        tutorialSpotlight.style.transition = '';
    }, 150);
}, { capture: true, passive: true });

// =============================================================
// END TUTORIAL TOUR MODULE
// =============================================================

// ── Setting info icon tooltip (position:fixed to escape overflow clipping) ──
{
    const gtt = document.getElementById('global-setting-tooltip');
    if (gtt) {
        document.addEventListener('mouseover', e => {
            const icon = e.target.closest('.setting-info-icon[data-tooltip]');
            if (!icon) return;
            gtt.textContent = icon.dataset.tooltip;
            gtt.style.display = 'block';
            const rect = icon.getBoundingClientRect();
            const w = 220, gap = 7;
            let left = rect.right - w;
            if (left < 8) left = 8;
            if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
            gtt.style.left = left + 'px';
            gtt.style.top = '0px';
            const h = gtt.offsetHeight;
            gtt.style.top = (rect.top - h - gap) + 'px';
            gtt.classList.add('visible');
        });
        document.addEventListener('mouseout', e => {
            if (!e.target.closest('.setting-info-icon[data-tooltip]')) return;
            gtt.classList.remove('visible');
        });
    }
}

});
