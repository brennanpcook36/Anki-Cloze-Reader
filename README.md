# Cloze Reader

A Mac desktop PDF reader that uses AI to turn selected passages into Anki cloze cards while you continue reading.

## Download for macOS

Download the build for your Mac from the repository's **Releases** page:

- Apple Silicon (`M1`, `M2`, `M3`, `M4`, or later): choose the `arm64.dmg` file.
- Intel Mac: choose the `x64.dmg` file.

The initial community release is unsigned. After dragging the app into Applications, right-click **Cloze Reader**, select **Open**, and confirm **Open** on first launch. Do not disable macOS Gatekeeper globally.

Before creating cards, install AnkiConnect in Anki using add-on code `2055492159`. AI mode also requires each user to supply their own OpenAI API key; the app never includes or shares the developer's key.

## What it does

- Opens local PDFs without uploading them
- Keeps imported PDFs in a persistent left-side Library
- Returns to the home screen without removing the active PDF from the Library
- Renames Library PDFs from a right-click menu
- Renders selectable text with PDF.js
- Waits for Enter after a selection, so ordinary text selection is not automatically captured
- Uses the OpenAI API to choose a concise, high-yield cloze deletion
- Switches between **Verbatim** wording and a faithful **Interpretative** rewrite from the fixed header
- Starts screenshot selection by right-clicking a PDF page
- Creates local Verbatim image-occlusion cards with a blurred front and unblurred back
- Creates Interpretative cloze cards from a cropped screenshot using the OpenAI vision API, with the source image beneath the generated text on the card front
- Generates 1–10 additional non-duplicate cards from any completed card and syncs the results to Anki
- Provides **Sync all** and **Clear all** controls for the current PDF's card list
- Keeps generated cards in a persistent reading sidebar
- Keeps the header visible with a persistent AI on/off switch
- Lets you edit the back after creation and paste images into Anki media
- Detects whether your Cloze note type calls its back field `Back Extra`, `Extra`, or another name
- Remembers highlights for each PDF
- Loads your Anki deck list and sends cards immediately through AnkiConnect
- Queues cards locally when Anki is closed
- Reopens an existing highlight for editing

## Run on a Mac

You need Node.js 20 or newer, the desktop version of Anki, and an OpenAI API key.

1. Install the **AnkiConnect** add-on in Anki using code `2055492159` and restart Anki.
2. Keep Anki open.
3. In Terminal, open this project folder and run:

   ```bash
   npm install
   npm start
   ```

4. Select **AI Settings** in the app and paste an API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys). The key is encrypted using macOS secure storage. API use is billed separately from ChatGPT subscriptions.

## Build the Mac installer

Run this command on the Mac:

```bash
npm run dist:mac
```

The `.dmg` and `.zip` will appear in the `dist` folder. Because this initial build is not code-signed, macOS may require right-clicking the app and choosing **Open** the first time.

Repository owners can follow [PUBLISHING.md](PUBLISHING.md) to create downloadable GitHub Releases automatically.

## How to use it

1. Open a PDF.
2. Highlight the passage containing the fact you want to remember.
3. Press **Enter** to confirm it; press **Escape** to cancel.
4. Choose **Verbatim** to preserve the wording or **Interpretative** to create a concise rewrite that preserves the highlighted knowledge exactly.
5. With **AI On**, AI selects the most useful answer span. With **AI Off**, the selected text becomes the cloze directly.
6. The card appears in the right sidebar and is automatically sent to your selected Anki deck.

To create a screenshot card, right-click anywhere on a PDF page, then drag a box around the desired text, image, or diagram. In **Verbatim** mode, drag a second box over the exact answer region to blur it; the unblurred answer appears on the back. In **Interpretative** mode, the selected crop is sent to OpenAI and a specific cloze card is generated from only the visible information; the screenshot appears beneath the generated text on the front. Press **Escape** to cancel screenshot selection.

Choose a number from **More cards** on any completed card and select **Generate more**. Text cards reuse the same passage, screenshot cards reuse the same image, and the generated cards avoid cards already created from that source. New cards sync to Anki automatically or remain queued if Anki is unavailable.

Select **Sync all** above the card list to send every unsynced card for the current PDF to Anki. Select **Clear all** to remove every local card and highlight for the current PDF; cards already synced to Anki are intentionally not deleted from Anki.

Select **Home** in the fixed header to close the current reader without removing the PDF. Click another PDF in the Library to open it. To change a Library title, right-click the PDF, select **Rename PDF…**, enter the new name, and select **Rename**.

After creation, select **Edit back** on a sidebar card to type notes or paste an image from the clipboard. Select **Save & sync** to update the existing Anki card and copy pasted images into Anki's media collection.

The header is fixed directly to the application window, so it remains available while the center PDF viewer scrolls.

The Anki deck selector sits in a separate fixed destination bar immediately below the main header, preventing it from covering the header controls.

Edit and resync cards from the sidebar while continuing to read. If Anki is unavailable, cards remain queued locally and the toolbar displays a retry button.

## Privacy

The complete PDF remains on your computer. For text cards, only the selected passage, nearby sentence, filename, and page number are sent to the OpenAI API. For an Interpretative screenshot card, only the cropped and resized selection is sent. Verbatim screenshot occlusion is processed entirely on the Mac and does not use the OpenAI API. Your API key is encrypted with Electron's macOS secure-storage facility. Anki synchronization occurs locally through `127.0.0.1:8765`.
