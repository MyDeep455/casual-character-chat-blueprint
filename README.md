# Casual Character Chat

Casual Character Chat is a free, private, fully local AI character chat app — no installation, no account, no cloud. Everything runs directly in your browser.

Create your own AI characters, start role-playing chats, and keep full control of your data. All conversations and settings are stored in your browser's local storage and never leave your device. API calls go straight from your browser to your chosen AI provider — no middleman, no server of its own.

---

### 🚀 Quick Start

1. **Download** — Click the green **<> Code** button above and select **Download ZIP**, then extract it.
2. **Open the app** — On **desktop**: double-click `index.html`. On **mobile**: open the **standalone HTML file** instead (or use a live server app), as smartphones block linked CSS/scripts when opening HTML files directly.
3. **Add your API key** — In the app, go to **⚙️ Global App Settings** and paste your API key from a provider - e.g., [OpenRouter](https://openrouter.ai). Done!

---

### ✨ Gallery

| Character Selection | API Settings | Chat List Screen |
| :---: | :---: | :---: |
| ![Character Selection](gallery/01_character_selection.png) | ![API Settings](gallery/02_api_settings.png) | ![Chat List Screen](gallery/03_chat_list_screen.png) |

| Character Editor | Chat Window | Chat Settings Menu |
| :---: | :---: | :---: |
| ![Character Editor](gallery/04_character_editor.png) | ![Chat Window](gallery/05_chat_window.png) | ![Chat Settings Menu](gallery/06_chat_settings_menu.png) |

---

### A Note on Your Data & Privacy

Your privacy is paramount. All of your data (including every character you create, all your chat histories, images, and your personal settings) is stored directly on your computer inside your browser's secure **IndexedDB** database. This means your data remains entirely on your device, is preserved even after you close the browser tab, and can never be accessed by anyone else.

All API calls go directly from your browser to your chosen AI provider — no intermediary server is involved in this version of the app.

---

## Bug Reports & Suggestions

If you find a bug or have an idea for a new feature, please open a ticket in the [Issues tab of the original repository](https://github.com/MyDeep455/casual-character-chat/issues).

---

## 1. The Main Screen: Character Selection

This is the first screen you see when you open the app. From here, you can access all of your characters and core features.

### The Top Bar (Header)

The header provides access to the app's main functions:

* **🤖 + Create Character:** Click this to open the Character Editor and start building a new AI character from scratch.
* **🎭 Manage Personas:** This opens a panel where you can create and manage your different user profiles, or "Personas." A Persona defines who *you* are in a chat.
* **⚙️ Global App Settings:** This is where you enter your API key and manage your list of available AI models and providers.
* **⬆️ Import / ⬇️ Export:** These buttons allow you to save your entire collection (characters, personas, and app settings) into a single `.json` file for backup or migration.
* **❓Help & FAQ:** This button opens the detailed help and FAQ document.
* **🔒 Privacy & Terms:** Opens the Privacy Policy and Terms of Use.

### ⭐ The Favorites Bar

This bar gives you quick access to your most-used characters. To add a character, simply hover over their card in the main list and click the star icon (★).

### 🔎 The Search Bars

To find specific characters quickly, the app features two separate search bars:

* **Search Name:** Filters the character list in real-time as you type a character's name.
* **Search Tag:** Filters the list based on the tags you've assigned to your characters in the character editor.

### The Character List & Cards

All of your non-archived characters are displayed here as individual cards, automatically sorted in alphabetical order. Clicking a card takes you to that character's chat dashboard. When you hover over a card, two buttons appear:

* **Favorite Button (★):** Adds or removes the character from your Favorites Bar.
* **Archive Button (↓/↑):** Moves a character to the archive or restores them to the main list.

### 🗑️ Bulk Delete & 🗃️ Archive

* **Bulk Delete Button:** Opens a modal where you can select and delete multiple characters at once.
* **The Archive:** This collapsible section at the bottom holds all archived characters to keep your main screen clean. It only appears if you have at least one character in the archive.

---

## 2. The Chat Dashboard

After clicking on a character card, you land on their personal dashboard, the hub for all conversations with that character.

### Header & Management

* **← Back to Main Menu:** Returns to the character selection screen.
* **Delete Character:** Permanently deletes the character and all their chats (with confirmation).
* **Edit Character:** Opens the Character Editor for the current character.
* **Copy Character:** Creates an exact duplicate of the character (without chat history), perfect for creating variations.

### Saved Chats

This section lists all separate chat sessions with this character.

* **+ Start new Chat:** Begins a new conversation. If scenarios exist, you'll be prompted to choose one or start an empty chat.
* **Chat Entries:** Each saved chat can be individually **Renamed** or **Deleted**.

---


## 3. The Character Editor

This is where you bring your characters to life. All changes you make here take effect immediately, even in ongoing chats.

### Key Input Fields

* **Card Name & In-Chat Name:** The full name displayed on the character card (e.g., "Natsuki Subaru - Re:Zero") and the shorter name used in dialogue and by the AI (e.g., "Subaru").
* **Avatar & Background URL:** Direct links or local file uploads (via the 📁 icon) for the character's profile picture and chat background.
* **Character Description:** The most crucial field. Describe identity, personality, appearance, abilities, speech style, and provide dialogue examples. A good length is between 500-1000 words.
* **Lorebook:** For deeper background information, world-building details, relationships, or any facts the AI should know that don't fit into the core personality description.
* **Tags:** Add comma-separated keywords to help you organize and find your characters (e.g., "anime, fantasy, villain").
* **AI Instructions:** General, system-level commands for the AI's behavior (e.g., "Write short and creative sentences."). If possible, keep your instructions concise. It will be easier then for the AI to follow your prompts. Less is more!
* **Character & Narrator Reminders:** Short, critical instructions attached to every message to prevent the AI from forgetting key details. Use the dynamic placeholder `{{char}}` to automatically insert the character's name for the AI. If the AI ignores some of your AI Instructions, you can put them here. Reminders have very high priority for the AI. But here too: keep it concise.

### Dynamic Scenario Management

Scenarios are pre-written starting points for a chat. Each scenario consists of a **Title** and a **Description** (the opening message). You can add, edit, and delete as many scenarios as you like for each character.

---

## 4. The Chat: Interacting with the AI

This is where the magic happens. The chat screen is designed to be immersive and give you full control over the conversation.

### The Chat Header

The top bar provides context and quick access to important features:

* **← Back Arrow:** Returns you to the character's chat dashboard.
* **Participant Icons:** In a group chat, icons of all participants appear here. Click an icon to remove that character.
* **Token Info (ℹ️):** Hover to see an estimate of the tokens being used in the current context.
* **Chat Memories (🧠):** Opens a text field for persistent, high-priority notes for this chat session. Notes are sent with every AI request — ideal for facts or constraints the AI tends to forget.
* **Add Participant (👥):** Opens a menu to add another character to the conversation.
* **Select Persona (🎭):** Allows you to choose one of your user profiles for the chat. You can unselect it at any time by clicking the button again.
* **Settings (⚙️):** Toggles the settings panel for live customization.

### The Settings Panel

This panel lets you customize the chat's appearance and the AI's behavior on the fly:

* **Appearance:** Adjust font size, message spacing, chat bubble colors & opacity, a "frosted glass" blur effect, and the character's avatar size.
* **AI Behavior:**
    * **AI Model:** Select the AI model for the responses from the list you configured in the global App Settings.
    * **Temperature:** The most important slider for creativity. Range is 0.1–1.0. Lower values (e.g., 0.7) are more focused; higher values (e.g., 1.0) lead to more creative and varied responses.
* **Notification Sound:** A toggle for the sound effect when a message is received.
* **Show Think Blocks:** A toggle to show or hide the collapsible reasoning block that some AI models produce. When disabled, only the final response is shown.

### Message Interaction

* **Editing:** **Double-click** any message bubble to open the message editor. Press `ENTER` or double-click outside the editor to save.
* **Deleting:** Hover over a message to reveal a trashcan icon (🗑️). Clicking it deletes that message **and all subsequent messages**, allowing you to rewind the story.
* **Response Variations:**
    * **Browse:** Use the `<` and `>` buttons (or Left/Right Arrow keys) to cycle through different AI-generated responses for the same prompt.
    * **Regenerate (⟳):** Generates a new response variation.
    * **Continue (»):** Prompts the AI to intelligently continue its last message, perfect for extending a good response.
* **AI Thoughts:** If the AI model provides them, its reasoning will appear in a collapsible think block above the main message. Click "Show Thoughts" to read the AI's internal reasoning.

### The Input Area

* **💬 Character vs. 📖 Narrator:** Use the `Character` button for standard dialogue and the `Narrator` button for third-person, omniscient narration.
* **Stopping a Response (🟥):** A red stop button appears while the AI is generating a response. Click it to cancel the request immediately.
* **Empty Submission:** Clicking either send button with an empty input field prompts the AI to continue the story based on the last message.

---

## 5. Persona Management

While characters are the AI entities you talk to, a **Persona** is a reusable profile for **you**, the user. It defines your name, appearance, and role, giving the AI crucial context about who it's talking to.

### Managing Your Personas

* Click the **🎭 Manage Personas** button on the main screen to open the management window.
* From here, you can **Create**, **Edit**, and **Delete** your personas.
* The Persona Editor includes fields for a name, description, avatar URL, and a live token counter.

### Using a Persona

* Click the **🎭 Select Persona** button in the chat header to choose a profile. You can unselect it at any time by clicking the button again.
* Once selected, your persona's avatar will appear next to your messages (if you linked/uploaded an avatar image), and its description will be included in the context sent to the AI.

---

## 6. Group Chats

You can turn any conversation into a group chat with multiple AI characters.

* **Adding Participants:** Click the **Add Participant (👥)** button in the chat header to open a selection screen and add any of your other characters to the chat.
* **Removing Participants:** Click the small icon of a character in the chat header to remove them.
* **Addressing Specific Characters:** Click the input field to see tag suggestions for all participants appear above it. Click a tag to select that character — all your messages will go to them until you deselect. You can also type `/` followed by the character's name manually (e.g., `/Alice "What do you think?"`).

---

## 7. Import, Export & Backups

Your data is stored locally in your browser, which is great for privacy but can be at risk if your browser data is cleared. This feature is the best way to safeguard your creations. Ideal for:

* **Backups:** Create a safe copy of all your characters, personas, and app settings.
* **Migration:** Easily move your entire collection to a different computer or browser.

### How to Export

Exporting creates a single `.json` file containing all your data, including uploaded images.

1.  Click the **⬇️ Export** button in the main screen header.
2.  Your browser will open a "Save File" dialog.
3.  Choose a safe location on your computer and click "Save". That's it!

### How to Import

1.  Click the **⬆️ Import** button in the header.
2.  Select the `.json` backup file from your computer — or import any character card (PNG/V2 or `.json`) from another character chat platform.
3.  Confirm the import. The app will merge the data, adding new characters and personas without overwriting your existing ones.

---

## 8. Frequently Asked Questions (FAQ)

**Q: My AI's responses are weird/short/repetitive. What can I do?**
A: This depends on your prompts and settings. Try these steps:
* **Improve Prompts:** A detailed `Character Description` is the most important factor. Also, tell the AI in the Character Reminder to drive the plot forward to the next scene.
* **Adjust Temperature:** In the chat settings, a lower value is more focused, a higher value is more creative.
* **Regenerate:** Use the `⟳` button. The AI's second or third try is often better.
* **Change the Topic:** Introduce a new situation to give the AI fresh input.

**Q: The app is slow, or the AI isn't responding. What's wrong?**
A: Since the app communicates directly with your AI provider, slowdowns are caused by the provider's servers (e.g., OpenRouter) being under high load or a free model being temporarily unavailable. The app will retry automatically. Try switching to a different AI model in the settings or wait a few minutes and try again.

**Q: What's the difference between `Character Description` and `Lorebook`?**
A: The `Character Description` is the active personality—*who the character is*. The `Lorebook` is background knowledge—*what the character knows*. This separation helps the AI focus on role-playing while still having access to deeper context. However, the Lorebook can also be regarded as an all-knowing encyclopedia about the world and various individuals besides your character. Also, the lorebook can be much longer, with up to 5,000 words or even more, and the AI only picks out what is relevant for a particular scene.

**Q: Why are my Characters and Personas suddenly gone?**
A: This happens if your browser's site data was deleted. This can be caused by browser settings that clear data on close or by manually clearing your cache. Use the **Export** feature regularly to create backups!


---

## 9. Setup Guide

### Step 1: Download and Open the App

1.  On this repository page, click the green **<> Code** button and select **Download ZIP**.
2.  Extract the ZIP. You'll have a folder with all the app files.
3.  **On desktop:** Just double-click `index.html` to open it in your browser — everything works.
    * To also load the starter character pack on first launch, open the folder in VS Code and use the **Live Server** extension to serve `index.html`.
4.  **On mobile:** Smartphones block linked CSS and scripts when opening an HTML file directly, so the app won't look or work right that way. Use one of these options instead:
    * Open the **standalone HTML file** (included in the folder) in your mobile browser — it bundles everything into one file and works out of the box.
    * Or open `index.html` via a **live server app** on your device (e.g. the "Live Server" app).

### Step 2: Get Your API Key from OpenRouter

1.  **Create an Account:** Go to [OpenRouter.ai](https://openrouter.ai) and create a free account.
2.  **Add Credits (recommended):** You get 50 free messages per day. For regular use, add $10 in credits once — this unlocks 1,000 free messages per day, forever, even after spending those credits. Go to **Settings → Credits & Usage**.
3.  **Create a New Key:** Go to your **Keys** page, click "Create Key", and give it a name.
4.  **Copy Your Key:** Copy the key starting with `sk-or-v1-...`. **Save it somewhere safe — you won't see the full key again after leaving this page.**

### Step 3: Connect Your API Key

1.  In Casual Character Chat, click **⚙️ Global App Settings** on the main screen.
2.  Paste your key into the **"Default API Key (OpenRouter)"** field.
3.  Click **Save Settings**. You're done — start chatting!

