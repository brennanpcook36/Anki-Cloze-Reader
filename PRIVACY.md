# Privacy

Cloze Reader is a local desktop application.

- Imported PDFs, highlights, card drafts, and the Library index stay on the user's Mac.
- Anki synchronization is sent only to the local AnkiConnect service at `127.0.0.1:8765`.
- When AI is enabled, only the selected passage, nearby sentence, displayed PDF name, and page number are sent to the OpenAI API.
- The complete PDF is not sent to OpenAI.
- Each user supplies their own OpenAI API key. The key is encrypted using Electron's macOS secure-storage facility and is not included in exported builds or this repository.
- With AI disabled, no card text is sent to OpenAI.

Users should avoid selecting protected health information or other confidential material for AI processing unless their organizational policies and API agreement permit it.
