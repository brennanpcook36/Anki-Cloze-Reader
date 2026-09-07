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

## Version 0.7.0

Auto sync in the header defaults to off. Review drafts with Preview, then use Save & sync or Sync all. Turn Auto sync on to send future generated cards automatically. New deck beside the deck selector creates and selects an Anki deck; subdecks use Parent::Child names. Anki must be open.

Batch generation may return fewer cards when the source has insufficient additional information. Exact repeated statements are filtered; semantic duplicates and factual accuracy still need human review. Work stays associated with its PDF during generation. Sync requests are guarded against repeated clicks, and app-specific Anki tags let retries recover previously created notes.

Preview shows the standard Cloze front/back content. Custom Anki templates may display differently. No account or payment system is included in this release.

## Version 0.8.0: study workflow

- **Study Profile:** Use the header button to create, edit or delete named profiles with a role, goal and preferences. Choose one from the adjacent dropdown, or select Profile off. The selected description is sent only with Interpretative AI requests (including screenshots and Generate more). Source fidelity takes priority over the profile.
- **Improve:** On a card, enter revision instructions and choose a revision or 2–4 split cards. Edit the returned proposals before applying. Revisions keep the existing Anki note reference; splits retain the original and create new drafts. Use Save & sync after review, even when Auto sync is on. Verbatim revisions preserve source wording.
- **Source:** Jump to the original PDF page and selected region.
- **Undo removal:** Restore removed cards or Clear all for the current PDF, up to 20 operations during this app session. Anki notes are never deleted by these controls.
- **Reading memory:** Each PDF remembers its position, selected deck and Study Profile locally.
- **Screenshot placement:** Choose Front, Back or Neither for ordinary screenshot cards, then Save & sync. Front images follow the cloze text. Image-occlusion cards retain the blurred front and unblurred answer pairing.

Profiles and reading preferences remain local. Active profile descriptions and refinement instructions accompany the source content sent to OpenAI when you request AI generation. There are no accounts, payments or community sharing in this update.

Local checks cover syntax, existing card utilities, batch filtering, profile gating and image-placement decisions. Live macOS, OpenAI, Anki and custom-template behavior must be tested locally before releasing installers.

## Version 0.9.0: bulk creation

Open a PDF and select **Bulk create** in the destination bar. Enter a PDF page range such as `20–28` (PDF page numbers, which may differ from printed page numbers). Choose a fixed maximum or **Let AI decide**, capped at 1–50 cards. Each job supports up to 30 pages. Select Verbatim or Interpretative; the latter uses the active Study Profile.

**Include diagrams and images** sends resized page images with extracted text. It increases API usage and allows analysis of scanned pages. Source page images appear beneath the generated text and can be moved with the sidebar screenshot placement selector.

The job processes three pages at a time and examines the full range. A final selection request may be used to stay within the limit. Fewer cards are returned if there are insufficient distinct facts. Text-only Verbatim outputs are checked against source excerpts. Duplicate statements and invalid page numbers are filtered, but human review remains necessary.

All cards remain drafts regardless of Auto sync. Edit, remove, and select cards in the bulk review, then choose **Sync selected**. The sidebar also contains the saved drafts. Closing the dialog lets generation continue; reopening it shows progress. Stop after current section keeps completed drafts and stops further page-generation requests. An interrupted or failed job retains completed drafts. Quitting the app ends ongoing work.

Bulk work uses a separate PDF instance so switching documents does not destroy it. Sources use PDF page references and can be visited with the sidebar Source button.

## Version 0.9.1: reliable pages and self-contained cards

- Every Interpretative workflow now requires independently answerable cards that explicitly identify the subject. This applies to highlights, screenshots, Generate more, Improve, and bulk creation. Ambiguous outputs beginning with references such as “it,” “this,” “the lesion,” or “the condition” are rejected; unsupported context is not invented.
- Opening or closing PDFs now invalidates unfinished work from the previous render. The viewer reserves page positions in the PDF's original numeric order before drawing them, preventing an older asynchronous render from mixing pages into the current document.
- Library ordering is unchanged.

## Version 0.9.2: clearer controls and Open Anki

- The main header now groups document and card-creation actions first: Home, Open PDF, Bulk create, wording mode, Study Profile, and AI controls.
- Bulk create moved from the Anki destination bar into the main header.
- The second bar now contains only Anki-related controls: deck selection, New deck, Open Anki, connection status, queued-card retry, and Auto sync.
- Open Anki launches the installed macOS Anki application and retries the local AnkiConnect connection for several seconds. If Anki or AnkiConnect is unavailable, Cloze Reader displays a clear message.
- Connection indicators use smaller status pills with colored dots, and long document names remain truncated to protect control space.

## Version 0.9.3: live Anki reconnection and correct home state

- Cloze Reader now checks AnkiConnect after Open Anki, whenever its window regains focus, and every five seconds while running. Opening Anki after Cloze Reader therefore updates the connection and deck list without restarting the app.
- The “Turn reading into recall” home screen appears at startup and after selecting Home. Opening a Library PDF or choosing a new PDF hides the home screen completely so only the document viewer is shown.

## Version 0.9.4: stable deck selection and unified Study Profile

- The five-second Anki heartbeat now asks only for connection status and never rebuilds the deck selector. The deck list refreshes only at initial connection, reconnection, or after creating a deck, and preserves the selected deck when refreshed.
- Study Profile is now one unified header control containing its label, active-profile dropdown, and an integrated Edit button for creating or managing profiles.

## Version 0.9.5: open at page and aligned header

- Right-click a PDF in the Library and choose **Open at page…** to enter a PDF page number. Cloze Reader opens the document at that page, validates the number against the document, and remembers the resulting reading position.
- Main-header buttons, the wording-mode switch, Study Profile control, and AI toggle now share a consistent 38-pixel height with vertically centered labels.

## Version 0.9.6: fast page jumps and lazy rendering

- Opening a PDF now creates lightweight page placeholders, moves immediately to the requested or remembered location, and renders that page first.
- Nearby and visible pages render next as you scroll instead of forcing every earlier page to finish sequentially. This makes **Open at page…** practical for high page numbers in large textbooks and reduces unnecessary memory use.
- Screenshot capture waits until the visible PDF page has finished rendering, while highlights safely appear when a lazily loaded page becomes ready.

## Version 0.10.0: stability release

- Lazy PDF pages now show a clear loading indicator instead of an unexplained blank sheet.
- Rendered canvases more than four screen-heights from the viewport are released from memory. Returning to those pages renders them again, preserving page order, reading position, and saved highlights while keeping large textbooks smoother.
- **Refresh Anki** deliberately reloads connection status and the deck list while preserving the selected deck. The quiet five-second heartbeat still checks connection only and does not alter the selector.
- Connection status now distinguishes **Anki closed** from **AnkiConnect unavailable**, making setup failures easier to diagnose.
- Existing interrupted-generation recovery, document-specific local saving, queued synchronization, and duplicate-safe Anki retry behavior remain enabled.
