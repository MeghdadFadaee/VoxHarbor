# Console workflow implementation

The client follows the supplied Console / Product UI's page structure using separate hash routes. Only short confirmations and pokes are dialogs. All live transport, identity and encrypted storage operations remain attached to the signed-in account.

## Pages and transitions

- **Connections** is the starting page after sign-in. Saved destinations expose nickname, connection status, direct Connect/Open console, Edit and active Disconnect actions. Add opens a complete editor. A backend-saved last connection remains available even without a bookmark. One active server per account is enforced in the interface and backend.
- **Connection editor** keeps name, destination, nickname, optional channel and password handling in one form. Save returns to the destination list. Save & connect saves first and then opens the console. Leaving unsaved edits requires an explicit discard choice. Blank saved passwords retain their existing meaning; the explicit removal control clears them. Delete requires confirmation and never removes the identity.
- **Console** shows the actual current room, participant mixer, conversation and voice panel. The room strip contains only the current and recently visited rooms, capped at four. The complete hierarchy is in All channels. Mixer and compact layouts share playback volume state.
- **Channels** provides ordered hierarchy, parent paths, occupancy, current-room and password labels, and search by room or participant. Selection previews the topic and participants in a separate panel. Previewing does not move the user. A denied join retains current audio; a successful channel change turns audio off. Phone selection brings the preview into view.
- **Private conversations** have a participant/thread list, message pane and recipient playback/poke controls. Selecting a participant binds the recipient to their current ID and UID. Incoming messages have unread counts. Reconnection invalidates recipient bindings; they must be selected again. Returning to the console restores channel conversation scope. Phone participant controls expand separately.
- **Identity** provides distinct creation/import choices for a new account and stored-identity/backup actions once an identity exists.
- **Audio**, **Presence** and **Diagnostics** are individual pages. Navigation does not disconnect the server or reset audio. An active-session ribbon exposes connection/audio state and microphone muting while outside the console.

Browser Back/Forward follows the page routes. Hashes contain page names only; credentials and destinations are not placed in URLs. Editor secrets clear on leaving the editor. Sign-out clears temporary audio, messages, recipients, unread counts and private fields. Messages remain bounded and are not automatically resent. Drafts are kept separately by conversation in bounded page memory, so a private draft never appears in channel chat. They clear on sign-out or a manual server change.

## Assets and responsive behavior

The console palette, locally hosted IBM Plex fonts and exported 22 × 22 microphone/headphone SVGs are retained. Font licenses remain in `public/fonts/OFL.txt`.

Phone layouts adapt the flows: destination actions stay visible, the complete connection form precedes save actions, channel results have bounded scrolling, participant cards become compact rows, and the console keeps accessible voice controls. Notifications are dismissible. All server, room, participant and account data are dynamic; simulation data is confined to local verification fixtures.

## Verification limits

Automated coverage includes large channel lists, hierarchy/participant search, bounded recent-room navigation and route validation, together with the protocol, storage, audio and account regression tests. Browser checks use a disposable simulated backend with 123 channels. They cover direct connections, saving/editing, discard/cancel, channel previews and joins, preserved listening after a denied join, private messaging, audio preferences and phone layouts.

These UI checks do not establish new real microphone/device or TeamSpeak interoperability results. See `AUDIO.md`, `TESTING.md` and `FEASIBILITY.md` for those limits.
