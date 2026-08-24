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

function getReasoningRequestConfig(targetApiUrl, reasoningEffort = 'auto') {
    if (!isOpenRouterChatCompletionsUrl(targetApiUrl)) return {};

    const normalizedEffort = typeof reasoningEffort === 'string'
        ? reasoningEffort.toLowerCase()
        : 'auto';

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
    short: Object.freeze({ words: '40-80 words', sentences: 'usually 3-5 sentences', verbosity: 'low' }),
    medium: Object.freeze({ words: '90-160 words', sentences: 'usually 6-9 sentences', verbosity: 'medium' }),
    long: Object.freeze({ words: '170-280 words', sentences: 'usually 10-15 sentences', verbosity: 'high' }),
    verylong: Object.freeze({ words: '300-500 words', sentences: 'usually 16-24 sentences', verbosity: 'high' })
});

function getReplyLengthInstruction(value) {
    const target = REPLY_LENGTH_TARGETS[value];
    if (!target) return '';

    return `--- TARGET REPLY LENGTH ---
Aim for ${target.words} (${target.sentences}) in this reply. Treat the word range as an approximate target, not a reason to cut off a sentence or leave the current story beat incomplete. Keep all content useful: do not pad, repeat, mention the target, or summarize these instructions.

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
    };

    let audioCtx;
    let soundEnabled = true;
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

// Card backdrop (blurred side fill): desktop keeps the full-res background
// feeding the live ::before blur layer. On touch devices that's one GPU
// filter surface per card — too much for mobile GPUs — so there the avatar
// is pre-blurred once into a tiny canvas and the upscaled result is used
// instead. Keyed by source identity, so an edited avatar gets a fresh backdrop.
const isCoarseTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const cardBackdropCache = new Map();

function setBlurredCardBackdrop(container, source, imageUrl) {
    if (!isCoarseTouchDevice) {
        container.style.backgroundImage = `url('${imageUrl}')`;
        return;
    }
    const cached = cardBackdropCache.get(source);
    if (cached) {
        container.style.backgroundImage = `url('${cached}')`;
        return;
    }
    const useLiveBlurFallback = () => {
        container.style.backgroundImage = `url('${imageUrl}')`;
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
            container.style.backgroundImage = `url('${dataUrl}')`;
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

    return {
        charsAdded, charsSkipped, personasAdded, personasSkipped,
        modelsAdded, modelsSkipped, modelsHydrated,
        hadAppSettings: Boolean(importedAppSettings),
    };
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
    <img src="${imageUrl}" alt="${character.name}" class="${favImageSource ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
    <div class="placeholder-icon ${favImageSource ? 'hidden' : ''}">${isWorldFav ? '🌍' : '👤'}</div>
</div>
  <span>${character.name}</span>
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
    <img src="${imageUrl}" alt="Avatar" class="${cardImageSource ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
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
    chatListScreen.style.backgroundImage = `url('${backgroundUrl}')`;
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
    avatarContainer.style.backgroundImage = `url('${dashboardAvatarUrl}')`;
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
        <span class="chat-group-name" data-group-id="${group.id}" role="button" tabindex="0" title="Open chat group">
          <span class="chat-group-icon" aria-hidden="true">🗂️</span>
          <span class="chat-group-title">${escapeHtml(group.name)}</span>
          <span class="chat-group-badge">Group</span>
          <span class="chat-group-count">${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}</span>
        </span>
        <div class="chat-session-actions">
          <button class="rename-group-btn" data-group-id="${group.id}">Rename</button>
          <button class="delete-group-btn" data-group-id="${group.id}">Delete</button>
        </div>`;
    chatSessionListDiv.appendChild(groupEntry);
  });

  chatIds.forEach(chatId => {
    const chat = allChats[chatId];
    const chatEntry = document.createElement('div');
    chatEntry.className = 'chat-session-entry';
    chatEntry.innerHTML = `
        <span class="chat-session-name" data-chat-id="${chatId}">${escapeHtml(chat.name)}</span>
        <div class="chat-session-actions">
          <button class="move-chat-btn" data-chat-id="${chatId}" title="Move this chat to a group">Move</button>
          <button class="rename-chat-btn" data-chat-id="${chatId}">Rename</button>
          <button class="delete-chat-btn" data-chat-id="${chatId}">Delete</button>
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



    function closeChatMemoriesModal() {
        if (chatMemoriesModal) {
            chatMemoriesModal.classList.add('hidden');
        }
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

        chat.memories = (chatMemoriesTextarea?.value || '').trim();
        delete chat.storyLine;
        delete chat.plan;
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
        if (window._musicFeatureReady) stopMusic();
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

    if (!chat.participants) chat.participants = [charId];
    if (chat.activePersonaId === undefined) chat.activePersonaId = null;
    chat.mood = normalizeMood(chat.mood);
    // A Story Line - and before it a General Plot plus milestones - is memory
    // text now, so it is folded into this chat's memories instead of dropped.
    chat.memories = getChatMemories(chat);
    delete chat.storyLine;
    delete chat.plan;
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
    updateChatReplyControls();
    updateChatMemoriesButtonState();
    updateTokenCount();
    updateMoodButton();
    updateParticleButton();
    startParticles(character.particleEffect || 'none', character.particleIntensityLevel);
    const musicUrlInputEl = document.getElementById('music-url-input');
    if (musicUrlInputEl) {
        const savedUserUrl = localStorage.getItem(`userMusicUrl:${currentCharacterId}`);
        const effectiveUrl = (savedUserUrl !== null) ? savedUserUrl : (character.musicUrl || '');
        musicUrlInputEl.value = effectiveUrl;
        if (window._musicFeatureReady) {
    const isNewSession = charId !== musicCurrentCharId || chatId !== musicCurrentChatId;
    if (isNewSession) {
        musicCurrentCharId = charId;
        musicCurrentChatId = chatId;
        if (effectiveUrl) playMusic(effectiveUrl); else stopMusic();
    }
}
    }
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
        const messageObject = {
            id: 'msg-' + Date.now(),
            sender: 'ai',
            type: isWorldCard ? 'story' : 'dialog',
            variations: [{ main: initialMessage, think: null }],
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
    // Set before the message box is focused below, since that focus fires the
    // handler that requests reply suggestions.
    chatTurnInProgress = true;
    hideUndoDeleteFab();
    // Suggestions for the reply being answered are now stale. Dropping the
    // round in flight matters as much as hiding the bar: its answer used to
    // arrive mid-stream and reopen the bar over the reply being written.
    cancelReplyOptions();
    const userMessageRaw = messageInput.value.trim();
    messageInput.value = '';
    autoResizeTextarea({ target: messageInput });
    messageInput.focus();
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
        addNewMessage(finalUserMessage, 'user', type, true);
        messageForAPI = finalUserMessage;
        const isMultiChar = chat.participants && chat.participants.length > 1;
        historyForAPI = chat.history.slice(0, -1).map(msg => {
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
    if (!chat.history || chat.history.length === 0) {
        messageForAPI = "Start the roleplay with a creative, exciting scenario, and introduce the central character in typical manner."; 
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
        const isMultiChar = chat.participants && chat.participants.length > 1;
        historyForAPI = historyCopy.map(msg => {
            if (msg.sender === 'ai') {
                const speaker = characters[msg.speakerId || currentCharacterId];
                const speakerName = speaker ? (speaker.chatName || speaker.name) : 'Character';
                const text = applyCharPlaceholder(msg.variations[msg.activeVariant].main, speakerName);
                return { sender: 'ai', main: msg.type === 'story' ? `[Narration] ${text}` : (isMultiChar && speaker?.type !== 'world') ? `${speakerName}: ${text}` : text };
            }
            const persona = chat.activePersonaId ? personas[chat.activePersonaId] : null;
            const userName = persona?.chatName || persona?.name || 'User';
            return { sender: 'user', main: isMultiChar ? `${userName}: ${msg.main}` : msg.main };
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
    currentStreamController = new AbortController();
    let fullReply = '';
    let streamAbortedByUser = false;
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
        if (worldChar.description) fullSystemPrompt += `--- WORLD CONTEXT ---\nWorld: ${worldName}\n${worldChar.description.trim()}\n\n`;
        const worldLoreText = getLoreText(worldChar, loreScanText);
        if (worldLoreText) fullSystemPrompt += `--- WORLD LORE & HISTORY ---\n${worldLoreText}\n\n`;
        if (worldChar.reminder) fullSystemPrompt += `--- WORLD RULES (CRITICAL — THESE RULES MAY NEVER BE BROKEN UNDER ANY CIRCUMSTANCES) ---\n${worldChar.reminder.trim()}\n\n`;
        if (targetCharId === currentCharacterId || type === 'story') {
            fullSystemPrompt += getNarratorMetaInstruction();
            const worldChars = chat.participants.filter(pid => pid !== currentCharacterId);
            if (worldChars.length > 0) {
                fullSystemPrompt += `--- CHARACTERS IN THIS WORLD ---\n`;
                worldChars.forEach(pid => {
                    const pChar = characters[pid];
                    if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
                });
                fullSystemPrompt += `\n`;
            }
        } else {
            if (targetCharacter.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(targetCharacter.instructions, charNameForAI), persona).trim()}\n\n`;
            if (targetCharacter.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${targetCharacter.description.trim()}\n\n`;
            const charLoreText = getLoreText(targetCharacter, loreScanText);
            if (charLoreText) fullSystemPrompt += `--- CHARACTER LORE ---\n${charLoreText}\n\n`;
        }
    } else if (type === 'story') {
        fullSystemPrompt += getNarratorMetaInstruction();
        fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
        chat.participants.forEach(pid => {
            const pChar = characters[pid];
            if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
        });
        const mainCharacterForLore = characters[currentCharacterId];
        const mainLoreText = getLoreText(mainCharacterForLore, loreScanText);
        if (mainLoreText) {
            fullSystemPrompt += `\n--- LORE / BACKGROUND KNOWLEDGE ---\n${mainLoreText}\n\n`;
        }
    } else {
        if (chat.participants && chat.participants.length > 1) {
            fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
            chat.participants.forEach(pid => {
                const pChar = characters[pid];
                if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
            });
            fullSystemPrompt += `\n`;
        }
        if (targetCharacter.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(targetCharacter.instructions, charNameForAI), persona).trim()}\n\n`;
        if (targetCharacter.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${targetCharacter.description.trim()}\n\n`;
        const targetLoreText = getLoreText(targetCharacter, loreScanText);
        if (targetLoreText) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${targetLoreText}\n\n`;
    }
    fullSystemPrompt += getMoodSystemContext({
        mood: chat.mood,
        characterName: charNameForAI,
        isNarration: isWorldChat || type === 'story'
    });
    const chatMemoriesText = getChatMemories(chat);
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${chatMemoriesText}\n\n`;
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
        if (!currentStreamController) { streamAbortedByUser = true; break; }
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
    ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort),
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
    signal: currentStreamController.signal,
    body: fetchBody
});

    clearStreamTimers();
            if (response.status === 429) {
                const elapsedTime = Date.now() - startTime;
if (elapsedTime > 20000) {
    const messageToUpdate = chat.history.find(m => m.id === newMessageId);
    if (messageToUpdate) {
        messageToUpdate.variations[0].main = `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
        updateSingleMessageView(newMessageId);
    }
}
                await new Promise(resolve => setTimeout(resolve, 1000));
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

                await saveSingleCharacterToDB(mainCharacter);
                playNotificationSound();
                updateTokenCount();
                if (!streamAbortedByUser && ttsEnabled && finalMainText) {
                    speakText(finalMainText, newMessageId);
                }
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
        const freshSendEl = document.querySelector(`[data-message-id="${newMessageId}"] .main-content`);
        if(freshSendEl) freshSendEl.innerHTML = errorMsg;
        else if(mainContentEl) mainContentEl.innerHTML = errorMsg;
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
    chatTurnInProgress = false;
    // Not after a stop, and not after a failure either: the bubble then holds
    // the "did not respond" notice, and suggesting replies to that is noise.
    if (!streamAbortedByUser && hasAnyReplyContent) generateReplyOptionsInBackground();
}



async function handleRegenerate(messageId) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
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
    const promptHistory = chat.history.slice(0, messageIndex);
    const lastUserMessageInHistory = promptHistory.slice().reverse().find(m => m.sender === 'user');
    const userMessageForAPI = lastUserMessageInHistory ? lastUserMessageInHistory.main : '';
    const historyForAPIcall = lastUserMessageInHistory ? promptHistory.slice(0, promptHistory.lastIndexOf(lastUserMessageInHistory)) : promptHistory;
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
        if (worldRegenChar.description) fullSystemPrompt += `--- WORLD CONTEXT ---\nWorld: ${worldName}\n${worldRegenChar.description.trim()}\n\n`;
        if (worldRegenChar.lore) fullSystemPrompt += `--- WORLD LORE & HISTORY ---\n${worldRegenChar.lore.trim()}\n\n`;
        if (worldRegenChar.reminder) fullSystemPrompt += `--- WORLD RULES (CRITICAL — THESE RULES MAY NEVER BE BROKEN UNDER ANY CIRCUMSTANCES) ---\n${worldRegenChar.reminder.trim()}\n\n`;
        if (speakerId === currentCharacterId || messageType === 'story') {
            fullSystemPrompt += getNarratorMetaInstruction();
            const worldChars = chat.participants.filter(pid => pid !== currentCharacterId);
            if (worldChars.length > 0) {
                fullSystemPrompt += `--- CHARACTERS IN THIS WORLD ---\n`;
                worldChars.forEach(pid => {
                    const pChar = characters[pid];
                    if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
                });
                fullSystemPrompt += `\n`;
            }
        } else {
            if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
            if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${characterForAPI.description.trim()}\n\n`;
            if (characterForAPI.lore) fullSystemPrompt += `--- CHARACTER LORE ---\n${characterForAPI.lore.trim()}\n\n`;
        }
    } else if (messageType === 'story') {
        fullSystemPrompt += getNarratorMetaInstruction();
        fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
        chat.participants.forEach(pid => {
            const pChar = characters[pid];
            if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
        });
        const mainCharacterForLore = characters[currentCharacterId];
        if (mainCharacterForLore?.lore) fullSystemPrompt += `\n--- LORE / BACKGROUND KNOWLEDGE ---\n${mainCharacterForLore.lore.trim()}\n\n`;
    } else {
        if (isMultiChar) {
            fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
            chat.participants.forEach(pid => {
                const pChar = characters[pid];
                if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
            });
            fullSystemPrompt += `\n`;
        }
        if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
        if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${characterForAPI.description.trim()}\n\n`;
        if (characterForAPI.lore) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${characterForAPI.lore.trim()}\n\n`;
    }
    fullSystemPrompt += getMoodSystemContext({
        mood: chat.mood,
        characterName: charNameForAI,
        isNarration: isWorldRegenChat || messageType === 'story'
    });
    const chatMemoriesText = getChatMemories(chat);
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${chatMemoriesText}\n\n`;
    }
    fullSystemPrompt += getReplyLengthInstruction(replyLength);
    const needsSpeakerExclusivity = messageType === 'dialog' && isMultiChar;
    if (needsSpeakerExclusivity) {
        fullSystemPrompt += getSpeakerExclusivityInstruction(charNameForAI, getOtherSpeakerNames(chat, speakerId));
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
    ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort),
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
    signal: currentStreamController.signal,
    body: fetchBody
});
            clearStreamTimers();
            if (response.status === 429) {
                const elapsedTime = Date.now() - startTime;
if (elapsedTime > 20000) {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate) {
        messageToUpdate.variations[message.activeVariant].main = `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
        updateSingleMessageView(messageId);
    }
}
await new Promise(resolve => setTimeout(resolve, 1000));
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
    chatTurnInProgress = false;
    // newVariant is only set once a reply actually arrived; without it the
    // variant holds an error notice, which is nothing to suggest replies to.
    if (!streamAbortedByUser && newVariant) generateReplyOptionsInBackground();
    await saveSingleCharacterToDB(characters[currentCharacterId]);
    updateSingleMessageView(messageId);
}



async function handleContinue(messageId) {
    const chat = characters[currentCharacterId]?.chats?.[currentChatId];
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
    const historyCopy = chat.history.slice(0, messageIndex + 1);
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
        if (worldContChar.description) fullSystemPrompt += `--- WORLD CONTEXT ---\nWorld: ${worldName}\n${worldContChar.description.trim()}\n\n`;
        if (worldContChar.lore) fullSystemPrompt += `--- WORLD LORE & HISTORY ---\n${worldContChar.lore.trim()}\n\n`;
        if (worldContChar.reminder) fullSystemPrompt += `--- WORLD RULES (CRITICAL — THESE RULES MAY NEVER BE BROKEN UNDER ANY CIRCUMSTANCES) ---\n${worldContChar.reminder.trim()}\n\n`;
        if (speakerId === currentCharacterId || messageType === 'story') {
            fullSystemPrompt += getNarratorMetaInstruction();
            const worldChars = chat.participants.filter(pid => pid !== currentCharacterId);
            if (worldChars.length > 0) {
                fullSystemPrompt += `--- CHARACTERS IN THIS WORLD ---\n`;
                worldChars.forEach(pid => {
                    const pChar = characters[pid];
                    if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
                });
                fullSystemPrompt += `\n`;
            }
        } else {
            if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
            if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${characterForAPI.description.trim()}\n\n`;
            if (characterForAPI.lore) fullSystemPrompt += `--- CHARACTER LORE ---\n${characterForAPI.lore.trim()}\n\n`;
        }
    } else if (messageType === 'story') {
        fullSystemPrompt += getNarratorMetaInstruction();
        fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
        chat.participants.forEach(pid => {
            const pChar = characters[pid];
            if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
        });
        const mainCharacterForLore = characters[currentCharacterId];
        if (mainCharacterForLore?.lore) fullSystemPrompt += `\n--- LORE / BACKGROUND KNOWLEDGE ---\n${mainCharacterForLore.lore.trim()}\n\n`;
    } else {
        if (isMultiChar) {
            fullSystemPrompt += `--- CHARACTERS IN SCENE ---\n`;
            chat.participants.forEach(pid => {
                const pChar = characters[pid];
                if (pChar) fullSystemPrompt += `Character: ${pChar.name}\nDescription: ${pChar.description || 'No description available.'}\n---\n`;
            });
            fullSystemPrompt += `\n`;
        }
        if (characterForAPI.instructions) fullSystemPrompt += `--- CHARACTER AI INSTRUCTIONS ---\n${applyUserPlaceholder(applyCharPlaceholder(characterForAPI.instructions, charNameForAI), persona).trim()}\n\n`;
        if (characterForAPI.description) fullSystemPrompt += `--- CHARACTER DESCRIPTION ---\n${characterForAPI.description.trim()}\n\n`;
        if (characterForAPI.lore) fullSystemPrompt += `--- LORE / BACKGROUND KNOWLEDGE ---\n${characterForAPI.lore.trim()}\n\n`;
    }
    fullSystemPrompt += getMoodSystemContext({
        mood: chat.mood,
        characterName: charNameForAI,
        isNarration: isWorldContChat || messageType === 'story'
    });
    const chatMemoriesText = getChatMemories(chat);
    if (chatMemoriesText) {
        fullSystemPrompt += `--- CHAT MEMORIES (HIGH PRIORITY, persist for this chat only; distinct from the initial scenario / first message) ---\n${chatMemoriesText}\n\n`;
    }
    fullSystemPrompt += getReplyLengthInstruction(replyLength);
    const needsSpeakerExclusivity = messageType === 'dialog' && isMultiChar;
    if (needsSpeakerExclusivity) {
        fullSystemPrompt += getSpeakerExclusivityInstruction(charNameForAI, getOtherSpeakerNames(chat, speakerId));
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
    ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort),
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
    signal: currentStreamController.signal,
    body: fetchBody
});
            clearStreamTimers();

            if (response.status === 429) {
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > 20000) {
    const messageToUpdate = chat.history.find(m => m.id === messageId);
    if (messageToUpdate) {
        messageToUpdate.variations[message.activeVariant].main = originalText + " " + `The selected AI Model experiences heavy traffic or is rate-limited (requests per minute). Please wait...`;
        updateSingleMessageView(messageId);
    }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
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
                streamAbortedByUser = true;
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
    chatTurnInProgress = false;
    if (!streamAbortedByUser) generateReplyOptionsInBackground();
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
        const avatarHtml = `<img src="${avatarSrc || ''}" alt="Avatar" class="${avatarSrc ? '' : 'hidden'}" onerror="this.style.display='none';this.nextElementSibling.classList.remove('hidden');"><div class="placeholder-icon ${avatarSrc ? 'hidden' : ''}">👤</div>`;
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
    editorAvatarContainer.style.backgroundImage = `url('${editorDisplayUrl}')`;
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
  document.getElementById('chat-list-screen').style.backgroundImage = backgroundUrl ? `url('${backgroundUrl}')` : 'none';
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
  const loreModeRadio = document.querySelector(`input[name="lore-mode"][value="${loreMode}"]`);
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
  const musicUrl = document.getElementById('char-music-url').value.trim();
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
            <input type="text" class="model-name-input" placeholder="Display Name (e.g., My favorite Model)" value="${name}">
            <input type="text" class="model-id-input" placeholder="Technical Model ID (e.g., provider/model-name)" value="${id}">
            <input type="url" class="model-target-api-url-input" placeholder="Other provider URL (https://.../v1/chat/completions)" value="${targetApiUrl}">
            <input type="password" class="model-api-key-input" placeholder="Other provider API Key (sk-1a2b3c...xyz)" value="${apiKey}">
            <input type="number" class="model-num-ctx-input" placeholder="Context length (only relevant for Ollama - e.g. 8192)" min="512" step="512" value="${numCtx}">
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
            showCustomAlert('There was an error processing the image file.');
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
        showCustomAlert("There was an error processing the image file.");
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
        thumb.style.backgroundImage = `url('${src}')`;

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
            showCustomAlert(failed === 1
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
    galleryActionImg.parentElement.style.backgroundImage = `url('${src}')`;
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
        showCustomAlert('There was an error processing the image file.');
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
            showCustomAlert('There was an error preparing the image for download.');
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
    <img src="${imageUrl}" class="${c.avatar ? '' : 'hidden'}" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
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
        if (!newChar.chats) newChar.chats = {};
        newChar.chats[currentChatId] = chatToMove;
        delete oldChar.chats[currentChatId];
        if (quickSwapModal) quickSwapModal.classList.add('hidden');
        await saveSingleCharacterToDB(oldChar);
        await saveSingleCharacterToDB(newChar);
        await startChat(newCharId, currentChatId);
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
    const particleCanvas = document.getElementById('particle-canvas');
    const particleCtx = particleCanvas ? particleCanvas.getContext('2d') : null;
    let particleAnimId = null;
    let particlesList = [];
    let currentParticleEffect = 'none';
    const particleBtn = document.getElementById('particle-btn');
    const particlePickerModal = document.getElementById('particle-picker-modal');
    const closeParticlePickerBtn = document.getElementById('close-particle-picker-btn');
    let particleIntensityLevel = 50;
    let intensityFactor = 1.0;
    const particleIntensitySlider = document.getElementById('particle-intensity-slider');
    const particleIntensityValue = document.getElementById('particle-intensity-value');
    const particleIntensityRow = document.getElementById('particle-intensity-row');

    const PARTICLE_EMOJIS = { none:'✨', snow:'❄️', rain:'🌧️', sparks:'🔥', fireflies:'🟢', sakura:'🌸', fog:'🌫️', steam:'♨️', aurora:'🌌', leaves:'🍂', darkness:'🌑' };
    function updateParticleButton() {
        if (!particleBtn) return;
        const effect = characters[currentCharacterId]?.particleEffect || 'none';
        particleBtn.textContent = PARTICLE_EMOJIS[effect] || '✨';
        particleBtn.title = effect !== 'none' ? `Effect: ${effect.charAt(0).toUpperCase()+effect.slice(1)}` : 'Ambient Effects';
        particleBtn.classList.toggle('particle-active', effect !== 'none');
    }

    let W = window.innerWidth, H = window.innerHeight;
    function resizeParticleCanvas() {
        if (!particleCanvas) return;
        W = window.innerWidth;
        H = window.innerHeight;
        particleCanvas.width = W;
        particleCanvas.height = H;
    }
    resizeParticleCanvas();
    window.addEventListener('resize', resizeParticleCanvas);

    function stopParticles() {
        if (particleAnimId) { cancelAnimationFrame(particleAnimId); particleAnimId = null; }
        if (particleCtx && particleCanvas) particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
        particlesList = [];
        currentParticleEffect = 'none';
    }

    function startParticles(effect, savedIntensity) {
        stopParticles();
        if (effect === 'none' || !particleCtx || !particleCanvas) return;
        if (savedIntensity !== undefined) {
            particleIntensityLevel = savedIntensity;
            intensityFactor = particleIntensityLevel / 50;
            if (particleIntensitySlider) particleIntensitySlider.value = particleIntensityLevel;
            if (particleIntensityValue) particleIntensityValue.textContent = particleIntensityLevel;
        }
        currentParticleEffect = effect;
        resizeParticleCanvas();

        if (effect === 'snow') {
            const BASE = 120;
            const spawnSnow = () => ({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*4+1.5, s: Math.random()*1.2+0.4, drift: (Math.random()-0.5)*0.5, opacity: Math.random()*0.3+0.7 });
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnSnow());
            (function drawSnow() {
                if (currentParticleEffect !== 'snow') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnSnow());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                particlesList.forEach(p => {
                    particleCtx.shadowBlur=8; particleCtx.shadowColor='rgba(200,230,255,0.7)';
                    particleCtx.fillStyle=`rgba(255,255,255,${Math.min(p.opacity*intensityFactor,1)})`;
                    particleCtx.strokeStyle='rgba(120,170,220,0.45)'; particleCtx.lineWidth=0.8;
                    particleCtx.beginPath(); particleCtx.arc(p.x,p.y,p.r,0,Math.PI*2);
                    particleCtx.fill(); particleCtx.stroke(); particleCtx.shadowBlur=0;
                    p.y+=p.s; p.x+=p.drift;
                    if (p.y>H) { p.y=-5; p.x=Math.random()*W; }
                    if (p.x<0||p.x>W) p.x=Math.random()*W;
                });
                particleAnimId = requestAnimationFrame(drawSnow);
            })();

        } else if (effect === 'rain') {
            const BASE = 150;
            const spawnRain = () => ({ x: Math.random()*W, y: Math.random()*H, len: Math.random()*25+15, s: Math.random()*6+10, opacity: Math.random()*0.35+0.55 });
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnRain());
            (function drawRain() {
                if (currentParticleEffect !== 'rain') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnRain());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                particlesList.forEach(p => {
                    particleCtx.shadowBlur=3; particleCtx.shadowColor='rgba(0,0,0,0.25)';
                    particleCtx.strokeStyle=`rgba(180,220,255,${Math.min(p.opacity*intensityFactor,1)})`; particleCtx.lineWidth=1.5;
                    particleCtx.beginPath(); particleCtx.moveTo(p.x,p.y); particleCtx.lineTo(p.x-p.len*0.2,p.y+p.len); particleCtx.stroke();
                    particleCtx.shadowBlur=0;
                    p.y+=p.s; p.x-=p.s*0.2;
                    if (p.y>H) { p.y=-p.len; p.x=Math.random()*(W+50); }
                });
                particleAnimId = requestAnimationFrame(drawRain);
            })();

        } else if (effect === 'sparks') {
            const BASE = 140;
            const spawnSpark = () => ({ x: Math.random()*W, y: H+Math.random()*60, vx: (Math.random()-0.5)*6, vy: -(Math.random()*6+3), life: Math.random(), maxLife: Math.random()*0.75+0.5, r: Math.random()*4+1.5 });
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnSpark());
            (function drawSparks() {
                if (currentParticleEffect !== 'sparks') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnSpark());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                const baseGrad=particleCtx.createLinearGradient(0,H,0,H-200);
                baseGrad.addColorStop(0,`rgba(255,55,0,${Math.min(0.25*intensityFactor,0.55)})`);
                baseGrad.addColorStop(0.45,`rgba(255,110,0,${Math.min(0.10*intensityFactor,0.22)})`);
                baseGrad.addColorStop(1,'rgba(255,60,0,0)');
                particleCtx.fillStyle=baseGrad; particleCtx.fillRect(0,H-200,W,200);
                particleCtx.globalCompositeOperation='lighter';
                particlesList.forEach(p => {
                    const t=p.life/p.maxLife;
                    let rv,gv,bv;
                    if (t>0.72){rv=255;gv=255;bv=Math.floor(220*(t-0.72)/0.28);}
                    else if (t>0.38){rv=255;gv=Math.floor(100+155*(t-0.38)/0.34);bv=0;}
                    else{rv=255;gv=Math.floor(70*t/0.38);bv=0;}
                    const alpha=Math.min(Math.min(1,t*2.2)*0.75*intensityFactor,1);
                    const gr=p.r*4.5;
                    const grad=particleCtx.createRadialGradient(p.x,p.y,0,p.x,p.y,gr);
                    grad.addColorStop(0,`rgba(255,255,220,${alpha})`);
                    grad.addColorStop(0.2,`rgba(${rv},${gv},${bv},${alpha*0.9})`);
                    grad.addColorStop(0.55,`rgba(${rv},${Math.floor(gv*0.4)},0,${alpha*0.35})`);
                    grad.addColorStop(1,'rgba(180,15,0,0)');
                    particleCtx.fillStyle=grad;
                    particleCtx.beginPath(); particleCtx.arc(p.x,p.y,gr,0,Math.PI*2); particleCtx.fill();
                    p.x+=p.vx; p.y+=p.vy; p.vy+=0.038; p.vx*=0.992; p.life-=0.007;
                    if (p.life<=0){p.x=Math.random()*W;p.y=H+Math.random()*20;p.vx=(Math.random()-0.5)*6;p.vy=-(Math.random()*6+3);p.life=p.maxLife;p.r=Math.random()*4+1.5;}
                });
                particleCtx.globalCompositeOperation='source-over';
                particleAnimId = requestAnimationFrame(drawSparks);
            })();

        } else if (effect === 'fireflies') {
            const BASE = 55;
            const spawnFirefly = () => ({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*4+2.5, phase: Math.random()*Math.PI*2, vx: (Math.random()-0.5)*0.5, vy: (Math.random()-0.5)*0.5, hue: 55+Math.random()*30 });
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnFirefly());
            let ff = 0;
            (function drawFireflies() {
                if (currentParticleEffect !== 'fireflies') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnFirefly());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H); ff+=0.025;
                // Pass 1: additive soft outer halo, elongated along travel direction
                particleCtx.globalCompositeOperation='lighter';
                particlesList.forEach(p => {
                    const glow=(Math.sin(ff+p.phase)+1)/2;
                    if (glow<0.15) return;
                    const angle=Math.atan2(p.vy,p.vx);
                    const haloR=p.r*(2+glow*2);
                    particleCtx.save();
                    particleCtx.translate(p.x,p.y); particleCtx.rotate(angle); particleCtx.scale(1.4,0.65);
                    const hg=particleCtx.createRadialGradient(0,0,0,0,0,haloR);
                    hg.addColorStop(0,`hsla(${p.hue},100%,80%,${Math.min(glow*0.18*intensityFactor,1)})`);
                    hg.addColorStop(1,`hsla(${p.hue},100%,60%,0)`);
                    particleCtx.fillStyle=hg;
                    particleCtx.beginPath(); particleCtx.arc(0,0,haloR,0,Math.PI*2); particleCtx.fill();
                    particleCtx.restore();
                });
                particleCtx.globalCompositeOperation='source-over';
                // Pass 2: elongated body with shadowBlur shine + physics
                particlesList.forEach(p => {
                    const glow=(Math.sin(ff+p.phase)+1)/2;
                    const angle=Math.atan2(p.vy,p.vx);
                    const bodyR=p.r*Math.max(glow,0.2);
                    particleCtx.save();
                    particleCtx.translate(p.x,p.y); particleCtx.rotate(angle);
                    particleCtx.shadowBlur=14*glow+4; particleCtx.shadowColor=`hsla(${p.hue},100%,72%,${glow*0.6})`;
                    particleCtx.fillStyle=`hsla(${p.hue},100%,75%,${Math.min(0.2+glow*0.8*intensityFactor,1)})`;
                    particleCtx.beginPath(); particleCtx.ellipse(0,0,bodyR*1.5,bodyR*0.75,0,0,Math.PI*2); particleCtx.fill();
                    if (glow>0.35){
                        particleCtx.shadowBlur=4; particleCtx.shadowColor=`rgba(255,255,230,${glow*0.5})`;
                        particleCtx.fillStyle=`rgba(255,255,230,${Math.min(glow*0.85*intensityFactor,1)})`;
                        particleCtx.beginPath(); particleCtx.ellipse(0,0,bodyR*0.55,bodyR*0.32,0,0,Math.PI*2); particleCtx.fill();
                    }
                    particleCtx.shadowBlur=0;
                    particleCtx.restore();
                    p.x+=p.vx; p.y+=p.vy;
                    if (p.x<0||p.x>W) p.vx*=-1; if (p.y<0||p.y>H) p.vy*=-1;
                });
                particleCtx.shadowBlur=0;
                particleAnimId = requestAnimationFrame(drawFireflies);
            })();

        } else if (effect === 'sakura') {
            const BASE = 48;
            const spawnSakura = () => {
                const depth=Math.random()*0.55+0.45;
                return {
                    x:Math.random()*W, y:Math.random()*H, r:(Math.random()*6+6.5)*depth,
                    vy:(Math.random()*0.48+0.3)*depth, vx:(Math.random()*0.42+0.12)*(Math.random()<0.82?1:-1),
                    sway:Math.random()*0.95+0.35, wobble:Math.random()*Math.PI*2,
                    wobbleSpeed:Math.random()*0.025+0.009, rotation:Math.random()*Math.PI*2,
                    rotSpeed:(Math.random()-0.5)*0.052, flip:Math.random()*Math.PI*2,
                    flipSpeed:Math.random()*0.065+0.025, opacity:Math.random()*0.24+0.68,
                    hue:Math.random()*10+338, depth
                };
            };
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnSakura());
            (function drawSakura() {
                if (currentParticleEffect !== 'sakura') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnSakura());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                particlesList.forEach(p => {
                    p.wobble+=p.wobbleSpeed;
                    p.rotation+=p.rotSpeed;
                    p.flip+=p.flipSpeed;
                    p.x+=p.vx+Math.sin(p.wobble)*p.sway;
                    p.y+=p.vy;
                    const flipScale=0.16+Math.abs(Math.cos(p.flip))*0.84;
                    particleCtx.save();
                    particleCtx.translate(p.x,p.y);
                    particleCtx.rotate(p.rotation+Math.sin(p.wobble)*0.16);
                    particleCtx.scale(0.8,flipScale);
                    const baseOpacity = Math.min(p.opacity * (0.5 + intensityFactor * 0.5), 1);
                    const front=Math.cos(p.flip)>0;
                    const pg=particleCtx.createLinearGradient(0,-p.r,0,p.r*0.8);
                    pg.addColorStop(0,`hsla(${p.hue},80%,${front?88:76}%,${baseOpacity})`);
                    pg.addColorStop(0.58,`hsla(${p.hue+5},72%,${front?81:70}%,${baseOpacity})`);
                    pg.addColorStop(1,`hsla(${p.hue+9},68%,65%,${baseOpacity*0.82})`);
                    particleCtx.fillStyle=pg;
                    particleCtx.strokeStyle=`hsla(${p.hue+4},55%,58%,${baseOpacity*0.42})`;
                    particleCtx.lineWidth=0.55;
                    particleCtx.beginPath();
                    particleCtx.moveTo(0,p.r*0.78);
                    particleCtx.bezierCurveTo(-p.r*0.68,p.r*0.35,-p.r*0.76,-p.r*0.35,-p.r*0.2,-p.r);
                    particleCtx.quadraticCurveTo(0,-p.r*0.72,p.r*0.2,-p.r);
                    particleCtx.bezierCurveTo(p.r*0.76,-p.r*0.35,p.r*0.68,p.r*0.35,0,p.r*0.78);
                    particleCtx.closePath();
                    particleCtx.fill();
                    particleCtx.stroke();
                    particleCtx.strokeStyle=`hsla(${p.hue+5},62%,62%,${baseOpacity*0.32})`;
                    particleCtx.beginPath();
                    particleCtx.moveTo(0,p.r*0.6);
                    particleCtx.quadraticCurveTo(-p.r*0.08,0,0,-p.r*0.62);
                    particleCtx.stroke();
                    particleCtx.restore();
                    if (p.y>H+p.r*2){p.y=-p.r*2;p.x=Math.random()*W;}
                    if (p.x>W+p.r*2) p.x=-p.r*2;
                    if (p.x<-p.r*2) p.x=W+p.r*2;
                });
                particleAnimId = requestAnimationFrame(drawSakura);
            })();

        } else if (effect === 'fog') {
            const BASE = 30;
            const spawnFog = () => ({ x: Math.random()*W, y: H*0.15+Math.random()*H*0.9, rx: Math.random()*320+200, ry: Math.random()*110+65, opacity: Math.random()*0.18+0.13, vx: (Math.random()*0.5+0.1)*(Math.random()<0.5?1:-1), phase: Math.random()*Math.PI*2, layer: Math.floor(Math.random()*3) });
            for (let i = 0; i < Math.round(BASE * Math.max(intensityFactor, 0.3)); i++) particlesList.push(spawnFog());
            let fogT=0;
            (function drawFog() {
                if (currentParticleEffect !== 'fog') return;
                const target = Math.round(BASE * Math.max(intensityFactor, 0.3));
                while (particlesList.length < target) particlesList.push(spawnFog());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H); fogT+=0.003;
                [...particlesList].sort((a,b)=>a.layer-b.layer).forEach(p => {
                    const yOff=Math.sin(fogT+p.phase)*24;
                    particleCtx.save();
                    particleCtx.translate(p.x,p.y+yOff);
                    particleCtx.scale(1,p.ry/p.rx);
                    const scaledOpacity=Math.min(p.opacity*intensityFactor*2.5,0.85);
                    const grad=particleCtx.createRadialGradient(0,0,0,0,0,p.rx);
                    grad.addColorStop(0,`rgba(200,215,232,${scaledOpacity})`);
                    grad.addColorStop(0.42,`rgba(190,208,228,${scaledOpacity*0.62})`);
                    grad.addColorStop(1,`rgba(185,205,225,0)`);
                    particleCtx.fillStyle=grad;
                    particleCtx.beginPath(); particleCtx.arc(0,0,p.rx,0,Math.PI*2); particleCtx.fill();
                    particleCtx.restore();
                    p.x+=p.vx;
                    if (p.x<-p.rx*1.5) p.x=W+p.rx;
                    if (p.x>W+p.rx*1.5) p.x=-p.rx;
                });
                particleAnimId=requestAnimationFrame(drawFog);
            })();

        } else if (effect === 'steam') {
            const BASE = 55;
            const spawnSteam = () => ({ x: Math.random()*W, y: H*0.1+Math.random()*H, r: Math.random()*32+16, vy: -(Math.random()*0.95+0.3), vx: (Math.random()-0.5)*0.55, life: Math.random(), maxLife: Math.random()*0.75+0.45, opacity: Math.random()*0.17+0.1 });
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnSteam());
            (function drawSteam() {
                if (currentParticleEffect !== 'steam') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnSteam());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                particlesList.forEach(p => {
                    const t=p.life/p.maxLife;
                    const cr=p.r+t*140;
                    const alpha=Math.min(p.opacity*intensityFactor*2.5*(1-t*t*0.82),0.7);
                    const grad=particleCtx.createRadialGradient(p.x,p.y,0,p.x,p.y,cr);
                    grad.addColorStop(0,`rgba(245,249,255,${alpha})`);
                    grad.addColorStop(0.38,`rgba(230,243,255,${alpha*0.58})`);
                    grad.addColorStop(1,`rgba(220,240,255,0)`);
                    particleCtx.fillStyle=grad;
                    particleCtx.beginPath(); particleCtx.arc(p.x,p.y,cr,0,Math.PI*2); particleCtx.fill();
                    p.y+=p.vy; p.x+=p.vx+Math.sin(p.life*7)*0.55; p.life+=0.0024;
                    if (p.life>=p.maxLife){p.x=Math.random()*W;p.y=H*0.45+Math.random()*H*0.65;p.life=0;p.r=Math.random()*32+16;p.maxLife=Math.random()*0.75+0.45;}
                });
                particleAnimId=requestAnimationFrame(drawSteam);
            })();

        } else if (effect === 'aurora') {
            const BASE = 5;
            const AURORA_HUES = [125, 155, 175, 195, 270, 300];
            const spawnBand = (i) => ({
                hue: AURORA_HUES[i % AURORA_HUES.length]+Math.random()*14-7,
                phase: Math.random()*Math.PI*2,
                phaseSpeed: (Math.random()*0.003+0.0008)*(Math.random()<0.5?1:-1),
                flickerPhase: Math.random()*Math.PI*2,
                flickerSpeed: Math.random()*0.018+0.006,
                ampFrac: Math.random()*0.055+0.025,
                freq: Math.random()*1.2+0.5,
                yFrac: 0.08+(i/Math.max(BASE,5))*0.28+Math.random()*0.04,
                thickFrac: Math.random()*0.075+0.045
            });
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnBand(i));
            (function drawAurora() {
                if (currentParticleEffect !== 'aurora') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnBand(particlesList.length));
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                particleCtx.globalCompositeOperation='lighter';
                particlesList.forEach(b => {
                    b.phase+=b.phaseSpeed; b.flickerPhase+=b.flickerSpeed;
                    const flicker=(Math.sin(b.flickerPhase)+1)/2;
                    const opacity=Math.min((0.05+flicker*0.09)*intensityFactor,0.9);
                    const yBase=b.yFrac*H, amp=b.ampFrac*H, thick=b.thickFrac*H;
                    const STEPS=90;
                    particleCtx.save();
                    particleCtx.beginPath();
                    for (let i=0;i<=STEPS;i++){const x=(i/STEPS)*W,y=yBase+Math.sin(x/W*Math.PI*2*b.freq+b.phase)*amp-thick*0.3;i===0?particleCtx.moveTo(x,y):particleCtx.lineTo(x,y);}
                    for (let i=STEPS;i>=0;i--){const x=(i/STEPS)*W,y=yBase+Math.sin(x/W*Math.PI*2*b.freq+b.phase)*amp+thick*1.5;particleCtx.lineTo(x,y);}
                    particleCtx.closePath();
                    const grad=particleCtx.createLinearGradient(0,yBase-thick*0.5,0,yBase+thick*1.8);
                    grad.addColorStop(0,`hsla(${b.hue},100%,80%,0)`);
                    grad.addColorStop(0.2,`hsla(${b.hue},100%,75%,${opacity})`);
                    grad.addColorStop(0.6,`hsla(${b.hue},100%,60%,${opacity*0.45})`);
                    grad.addColorStop(1,`hsla(${b.hue},100%,50%,0)`);
                    particleCtx.fillStyle=grad; particleCtx.fill(); particleCtx.restore();
                });
                particleCtx.globalCompositeOperation='source-over';
                particleAnimId=requestAnimationFrame(drawAurora);
            })();

        } else if (effect === 'leaves') {
            const BASE = 40;
            const LEAF_PALETTE = [{h:88,s:52,l:36},{h:102,s:57,l:38},{h:118,s:48,l:34},{h:92,s:62,l:42},{h:108,s:55,l:40},{h:74,s:62,l:44},{h:79,s:58,l:46},{h:50,s:72,l:54},{h:54,s:68,l:50},{h:26,s:78,l:52},{h:28,s:80,l:48},{h:22,s:76,l:50},{h:30,s:72,l:48},{h:9,s:66,l:46},{h:13,s:70,l:44},{h:27,s:42,l:38}];
            const spawnLeaf = () => { const c=LEAF_PALETTE[Math.floor(Math.random()*LEAF_PALETTE.length)]; return {x:Math.random()*W,y:Math.random()*H,r:Math.random()*15+10,aspect:Math.random()*0.2+0.45,vy:Math.random()*0.9+0.35,drift:(Math.random()-0.5)*0.5,wobble:Math.random()*Math.PI*2,wobbleSpeed:Math.random()*0.022+0.008,rotation:Math.random()*Math.PI*2,rotSpeed:(Math.random()-0.5)*0.04,h:c.h,sat:c.s,l:c.l,opacity:Math.random()*0.2+0.75}; };
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnLeaf());
            (function drawLeaves() {
                if (currentParticleEffect !== 'leaves') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnLeaf());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                particlesList.forEach(p => {
                    p.wobble+=p.wobbleSpeed; p.rotation+=p.rotSpeed;
                    p.x+=p.drift+Math.sin(p.wobble)*0.35; p.y+=p.vy;
                    if (p.y>H+p.r*2){p.y=-p.r*2;p.x=Math.random()*W;}
                    if (p.x<-p.r*2) p.x=W+p.r*2; if (p.x>W+p.r*2) p.x=-p.r*2;
                    const baseOp=Math.min(p.opacity*(0.5+intensityFactor*0.5),1);
                    particleCtx.save();
                    particleCtx.translate(p.x,p.y); particleCtx.rotate(p.rotation);
                    const lg=particleCtx.createLinearGradient(0,-p.r,0,p.r);
                    lg.addColorStop(0,`hsla(${p.h},${p.sat}%,${Math.min(p.l+10,65)}%,${baseOp})`);
                    lg.addColorStop(1,`hsla(${p.h},${p.sat}%,${Math.max(p.l-8,20)}%,${baseOp})`);
                    particleCtx.fillStyle=lg;
                    particleCtx.strokeStyle=`hsla(${p.h},${p.sat-10}%,${p.l-18}%,${baseOp*0.45})`;
                    particleCtx.lineWidth=0.5;
                    particleCtx.beginPath();
                    particleCtx.moveTo(0,-p.r);
                    particleCtx.bezierCurveTo(p.r*p.aspect,-p.r*0.25,p.r*p.aspect,p.r*0.25,0,p.r);
                    particleCtx.bezierCurveTo(-p.r*p.aspect,p.r*0.25,-p.r*p.aspect,-p.r*0.25,0,-p.r);
                    particleCtx.closePath(); particleCtx.fill(); particleCtx.stroke();
                    particleCtx.strokeStyle=`hsla(${p.h},${p.sat-15}%,${p.l-22}%,${baseOp*0.3})`;
                    particleCtx.lineWidth=0.55;
                    particleCtx.beginPath(); particleCtx.moveTo(0,-p.r*0.8); particleCtx.lineTo(0,p.r*0.8); particleCtx.stroke();
                    particleCtx.restore();
                });
                particleAnimId=requestAnimationFrame(drawLeaves);
            })();

        } else if (effect === 'darkness') {
            const BASE = 18;
            const spawnWisp = () => ({x:Math.random()*W,y:Math.random()*H,r:Math.random()*220+100,vx:(Math.random()-0.5)*0.22,vy:(Math.random()-0.5)*0.14,pulsePhase:Math.random()*Math.PI*2,pulseSpeed:Math.random()*0.007+0.003,baseOp:Math.random()*0.18+0.12,purple:Math.random()<0.28});
            for (let i = 0; i < Math.round(BASE * intensityFactor); i++) particlesList.push(spawnWisp());
            (function drawDarkness() {
                if (currentParticleEffect !== 'darkness') return;
                const target = Math.round(BASE * intensityFactor);
                while (particlesList.length < target) particlesList.push(spawnWisp());
                if (particlesList.length > target) particlesList.length = target;
                particleCtx.clearRect(0,0,W,H);
                particleCtx.fillStyle=`rgba(0,0,0,${Math.min(0.25*intensityFactor,0.6)})`; particleCtx.fillRect(0,0,W,H);
                particlesList.forEach(p => {
                    p.pulsePhase+=p.pulseSpeed;
                    const pulse=(Math.sin(p.pulsePhase)+1)/2;
                    const op=Math.min((p.baseOp+pulse*0.1)*intensityFactor,0.75);
                    const r=p.r*(0.82+pulse*0.28);
                    const grad=particleCtx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
                    if (p.purple){grad.addColorStop(0,`rgba(12,0,22,${op})`);grad.addColorStop(0.55,`rgba(6,0,12,${op*0.5})`);}
                    else{grad.addColorStop(0,`rgba(0,0,0,${op})`);grad.addColorStop(0.55,`rgba(0,0,2,${op*0.45})`);}
                    grad.addColorStop(1,'rgba(0,0,0,0)');
                    particleCtx.fillStyle=grad; particleCtx.beginPath(); particleCtx.arc(p.x,p.y,r,0,Math.PI*2); particleCtx.fill();
                    p.x+=p.vx; p.y+=p.vy;
                    if (p.x<-p.r) p.x=W+p.r; if (p.x>W+p.r) p.x=-p.r;
                    if (p.y<-p.r) p.y=H+p.r; if (p.y>H+p.r) p.y=-p.r;
                });
                const vig=particleCtx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,Math.max(W,H)*0.8);
                vig.addColorStop(0,'rgba(0,0,0,0)');
                vig.addColorStop(1,`rgba(0,0,0,${Math.min(0.4*intensityFactor,0.7)})`);
                particleCtx.fillStyle=vig; particleCtx.fillRect(0,0,W,H);
                particleAnimId=requestAnimationFrame(drawDarkness);
            })();
        }
    }

    if (particleBtn) {
        particleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const character = characters[currentCharacterId];
            if (particlePickerModal) {
                const currentEffect = character?.particleEffect || 'none';
                particlePickerModal.querySelectorAll('.particle-option-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.effect === currentEffect);
                });
                const savedLevel = character?.particleIntensityLevel ?? 50;
                particleIntensityLevel = savedLevel;
                intensityFactor = particleIntensityLevel / 50;
                if (particleIntensitySlider) particleIntensitySlider.value = particleIntensityLevel;
                if (particleIntensityValue) particleIntensityValue.textContent = particleIntensityLevel;
                if (particleIntensityRow) particleIntensityRow.classList.toggle('hidden', currentEffect === 'none');
                particlePickerModal.classList.remove('hidden');
            }
        });
    }
    if (closeParticlePickerBtn) closeParticlePickerBtn.addEventListener('click', () => { if (particlePickerModal) particlePickerModal.classList.add('hidden'); });
    if (particleIntensitySlider) {
        particleIntensitySlider.addEventListener('input', async () => {
            particleIntensityLevel = parseInt(particleIntensitySlider.value, 10);
            intensityFactor = particleIntensityLevel / 50;
            if (particleIntensityValue) particleIntensityValue.textContent = particleIntensityLevel;
            const character = characters[currentCharacterId];
            if (character) {
                character.particleIntensityLevel = particleIntensityLevel;
                await saveSingleCharacterToDB(character);
            }
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
            particlePickerModal.querySelectorAll('.particle-option-btn').forEach(b => b.classList.toggle('active', b.dataset.effect === effect));
            if (particleIntensityRow) particleIntensityRow.classList.toggle('hidden', effect === 'none');
            await saveSingleCharacterToDB(character);
            startParticles(effect);
            updateParticleButton();
        });
    }

    // ── Feature B: Background Music ──
    const musicBtn = document.getElementById('music-btn');
    const musicPanel = document.getElementById('music-panel');
    const musicUrlInput = document.getElementById('music-url-input');
    const musicPlayBtn = document.getElementById('music-play-btn');
    const musicStopBtn = document.getElementById('music-stop-btn');
    let musicAudioEl = null;
    let musicIframeEl = null;
    let musicIsPlaying = false;
    let musicCurrentCharId = null;  
    let musicCurrentChatId = null;

    function extractYouTubeId(url) {
        const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    function stopMusic() {
        if (musicAudioEl) {
            musicAudioEl.pause();
            musicAudioEl.currentTime = 0;
            musicAudioEl.src = '';
            musicAudioEl.remove();
            musicAudioEl = null;
        }
        if (musicIframeEl) {
            musicIframeEl.src = '';
            musicIframeEl.remove();
            musicIframeEl = null;
        }
        musicIsPlaying = false;
        if (musicPlayBtn) musicPlayBtn.textContent = '▶ Play';
    }

    function pauseMusic() {
        if (musicAudioEl) musicAudioEl.pause();
        if (musicIframeEl) musicIframeEl.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
        musicIsPlaying = false;
        if (musicPlayBtn) musicPlayBtn.textContent = '▶ Play';
    }

    function resumeMusic() {
        if (musicAudioEl) musicAudioEl.play().catch(() => {});
        if (musicIframeEl) musicIframeEl.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
        musicIsPlaying = true;
        if (musicPlayBtn) musicPlayBtn.textContent = '⏸ Pause';
    }

    function playMusic(url) {
        stopMusic();
        if (!url) return;
        const ytId = extractYouTubeId(url);
        if (ytId) {
            musicIframeEl = document.createElement('iframe');
            musicIframeEl.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&loop=1&playlist=${ytId}&enablejsapi=1`;
            musicIframeEl.allow = 'autoplay';
            musicIframeEl.style.cssText = 'display:none;width:0;height:0;border:0;position:absolute;';
            document.body.appendChild(musicIframeEl);
            musicIsPlaying = true;
            if (musicPlayBtn) musicPlayBtn.textContent = '⏸ Pause';
        } else {
            const audio = document.createElement('audio');
            audio.src = url;
            audio.loop = true;
            document.body.appendChild(audio);
            musicAudioEl = audio;
            audio.play().catch(() => {
                musicIsPlaying = false;
                if (musicPlayBtn) musicPlayBtn.textContent = '▶ Play';
            });
            musicIsPlaying = true;
            if (musicPlayBtn) musicPlayBtn.textContent = '⏸ Pause';
        }
    }

    if (musicBtn) {
        musicBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (musicPanel) musicPanel.classList.toggle('hidden');
        });
    }
    document.addEventListener('click', (e) => {
        if (musicPanel && !musicPanel.classList.contains('hidden') &&
            !musicBtn?.contains(e.target) && !musicPanel.contains(e.target)) {
            musicPanel.classList.add('hidden');
        }
    });
    if (musicPlayBtn) {
        musicPlayBtn.addEventListener('click', () => {
            if (musicIsPlaying) {
                pauseMusic();
            } else {
                if (musicAudioEl || musicIframeEl) {
                    resumeMusic();
                } else if (musicUrlInput) {
                    playMusic(musicUrlInput.value.trim());
                }
            }
        });
    }
    if (musicStopBtn) musicStopBtn.addEventListener('click', stopMusic);
    if (musicUrlInput) {
        musicUrlInput.addEventListener('input', () => {
            const val = musicUrlInput.value.trim();
            const charId = currentCharacterId;
            if (!charId) return;
            if (val) {
                localStorage.setItem(`userMusicUrl:${charId}`, val);
            } else {
                localStorage.removeItem(`userMusicUrl:${charId}`);
            }
        });
    }
    // Mark Feature B as ready; auto-play if a URL was already populated during startChat
    window._musicFeatureReady = true;
    const _initMusicUrl = musicUrlInput ? musicUrlInput.value.trim() : '';
    if (_initMusicUrl && currentCharacterId) playMusic(_initMusicUrl);

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
        const btn = messageId ? document.querySelector(`[data-message-id="${messageId}"] .tts-btn`) : null;
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
    async function callAISimple(systemPrompt, userMessage, selectedModelId, signal = null, reasoningEffort = 'auto') {
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
                ...getReasoningRequestConfig(targetApiUrlToSend, reasoningEffort)
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
                IMAGE_PROMPT_SYSTEM, userMessage, suggestionModelId, signal, 'none'
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
        const chat = characters[currentCharacterId]?.chats?.[currentChatId];
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
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
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
                await saveSingleCharacterToDB(characters[currentCharacterId]);
            } catch (saveErr) {
                variation.images.pop();
                const quotaHit = saveErr?.name === 'QuotaExceededError'
                    || /quota/i.test(saveErr?.message || '');
                showCustomAlert(quotaHit
                    ? 'Out of browser storage, so the image was not saved. Remove some images or gallery pictures and try again.'
                    : `The image could not be saved: ${saveErr?.message || saveErr}`);
                return;
            }

            updateSingleMessageView(messageId);

            if (imageRecord.provider === 'pollinations') {
                maybeShowFreeImageHint(document.querySelector(`[data-message-id="${messageId}"]`));
            }

            if (typeof imageRecord.cost === 'number') {
                console.info(`[image] generated via ${imageRecord.provider} for $${imageRecord.cost.toFixed(5)}`);
            }
        } catch (err) {
            if (err?.name === 'AbortError') {
                // Cancelling is a deliberate act, so it passes without an alert.
            } else if (err?.name === 'ImageRefusalError') {
                // Already a full, plain-language explanation.
                showCustomAlert(err.message);
            } else {
                showCustomAlert(`Image generation failed: ${err?.message || err}`);
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
                raw = await callAISimple(attempt.system, attempt.user, modelId, controller.signal, 'none');
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
        const lastAIText = (lastMsg.variations?.[lastMsg.activeVariant ?? 0]?.main || '').trim();
        if (!lastAIText || lastAIText.length < 5) return;

        cancelReplyOptions({ hide: false });
        replyOptionsLoading = true;
        replyOptionsForMessageId = lastMsg.id;
        const reqId = ++replyOptionsReqId;

        _setReplyDropdownLoading();

        const character = characters[currentCharacterId];
        const charName = character?.chatName || character?.cardName || 'the character';
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
            h3.textContent = '✨ Generate Greeting';
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
                systemPrompt = `You are a creative writer for immersive world roleplay opening scenes. Write a medium-length opening paragraph (10-15 sentences) set in the world of ${worldName}. Rules:
- Write from an omniscient narrator perspective, establishing the setting and atmosphere of ${worldName}.
- Place the user ("you") into the scene as an active participant discovering or entering the world.
- Introduce at least one or two named inhabitants or characters of ${worldName} who experience something particular or interact with the user.
- Weave in at least three lines of dialog (from any involved character, in quotation marks), integrated naturally into the narration.
- Write the narration in a very direct, factual style — no prose, no flowery descriptions.
- Prefer short and medium-length sentences over long nested sentences with commas.
- Do not soften any dark, violent, or sexual content and describe it authentically without restriction.

World details:
World: ${worldName}
Description: ${charDesc.substring(0, 900)}
Lore/Background: ${charLore.substring(0, 700)}${hintSection}

Output ONLY the scenario paragraph. No title, no labels, no extra commentary.`;
            } else {
                systemPrompt = `You are a creative writer for character roleplay scenarios. Write a medium-length opening scenario paragraph (10-15 sentences) for an exciting story with ${charName}. Rules:
- Address ${charName} by name and with "he/she/him/her" in third person — ${charName} is the protagonist of the scene.
- If the user is part of the scenario (check user-specified hints), clarify the relationship or dynamic between ${charName} ("he/she/him/her") and the user ("you").
- Summarize the context of the scene and describe what ${charName} currently experiences or wants.
- Weave in three full lines of dialog spoken by ${charName} (in quotation marks), integrated naturally into the narration.
- Write the narration in a very direct, factual style - no prose, no flowery descriptions.
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
            showCustomAlert(_formatAIError(err, 'Scenario generation'));
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
            const historyText = chat.history.slice(-40).map(msg => {
                if (msg.sender === 'user') return `User: ${msg.main || ''}`;
                const text = msg.variations?.[msg.activeVariant]?.main || '';
                if (msg.type === 'story') return `Narrator: ${text}`;
                const charName = characters[msg.speakerId || currentCharacterId]?.chatName || 'Character';
                return `${charName}: ${text}`;
            }).join('\n\n');
            const systemPrompt = `You are a concise summarization assistant. Summarize the key story events, facts, and character developments from a roleplay chat. Output only 5-10 bullet points. No intro, no outro, no markdown headers.`;
            const userMessage = `Summarize the key events and facts from this roleplay conversation:\n\n${historyText}`;
            const summary = await callAISimple(systemPrompt, userMessage, selectedModelId);
            const existing = chatMemoriesTextarea.value.trim();
            chatMemoriesTextarea.value = existing
                ? `${existing}\n\n--- Summary (${new Date().toLocaleDateString()}) ---\n${summary}`
                : summary;
            autoResizeTextarea({ target: chatMemoriesTextarea });
        } catch (err) {
            showCustomAlert(`Summarization failed: ${err.message}`);
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
            showCustomAlert(_formatAIError(err, isWorld ? 'World generation' : 'Character generation'));
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

                const isWorldFav = character.type === 'world';
                const favImageSource = isWorldFav ? character.background : character.avatar;
                const imageUrl = getImageUrl(favImageSource);
                const favElement = document.createElement('div');
                favElement.className = 'favorite-item';
                favElement.dataset.charId = charId;
                favElement.innerHTML = `
                  <div class="avatar-container">
                    <img src="${imageUrl}" alt="${character.name}" class="${favImageSource ? '' : 'hidden'}" onerror="this.classList.add('is-broken')">
                    <div class="placeholder-icon ${favImageSource ? 'hidden' : ''}">${isWorldFav ? '🌍' : '👤'}</div>
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
    const CARD_CONVERTER_URL = 'https://mydeep455.github.io/roleplay-card-converter/';
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
    addSettingListener(avatarSizeSlider, 'avatarSize');
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
            lastDeletedSnapshot = { charId: currentCharacterId, chatId: currentChatId, fromIndex: messageIndex, messages: chat.history.splice(messageIndex) };
            await saveSingleCharacterToDB(characters[currentCharacterId]);
            updateTokenCount();
            startChat(currentCharacterId, currentChatId);
            chatWindow.scrollTop = currentScroll;
            showUndoDeleteFab();
            generateReplyOptionsInBackground();
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
            // Another variant is a different reply, so suggestions written for
            // the old one no longer fit. They are dropped rather than reordered
            // right away: focusing the message box asks for a fitting pair, and
            // browsing variants should not cost a request per click.
            if (messageId === chat.history[chat.history.length - 1]?.id) cancelReplyOptions();
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
                // Ignore regenerate requests while a generation is already
                // streaming; a second press mid-stream corrupts the formatting.
                if (currentStreamController) return;
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
                text: 'This row is per-chat: mood, ambient effects, music, memories and story plan, group chat, and your persona.',
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
