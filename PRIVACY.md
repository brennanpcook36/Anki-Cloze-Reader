# Privacy

Cloze Reader is a local desktop application.

- Imported PDFs, highlights, card drafts, and the Library index stay on the user's Mac.
- Anki synchronization is sent only to the local AnkiConnect service at `127.0.0.1:8765`.
- When AI is enabled, only the selected passage, nearby sentence, displayed PDF name, and page number are sent to the OpenAI API.
- The complete PDF is not sent to OpenAI.
- Each user supplies their own OpenAI API key. The key is encrypted using Electron's macOS secure-storage facility and is not included in exported builds or this repository.
- With AI disabled, no card text is sent to OpenAI.

Users should avoid selecting protected health information or other confidential material for AI processing unless their organizational policies and API agreement permit it.

Study Profiles are saved locally. When enabled for Interpretative generation, the selected profile description is sent to OpenAI alongside the source. Improve requests also send your revision instructions and current card. Reading position, preferred deck, and per-PDF profile selection are stored locally. No community collection or account system is introduced.

Bulk generation sends text from explicitly selected PDF pages, the active Study Profile for Interpretative requests, and existing card text for duplicate avoidance to OpenAI. Enabling Include diagrams and images also sends resized page images and stores them locally. A final selection request may send candidate cards to select a set within the limit. No community sharing or accounts are added.
