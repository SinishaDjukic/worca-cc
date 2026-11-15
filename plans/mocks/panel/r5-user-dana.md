# R5 · Dana: final verdict on r4-ux

**Pass.** All three of my fixes landed:

- **The narrowed list is one line:** `Needs you ⌄ billing-api ⌄ ✕ 2`. That's exactly it.
- **Tab order:** from the text, Tab goes repo → engine → finish → Customise, and Shift+Tab goes back to the text. Good. Typing "high" in the engine menu finds thorough, which is a nice bonus.
- **The New chat key:** ⌘N in the app or PWA, ⌥⌘N in a browser. I'm in the app all day, so that works for me.

## Nits

1. The New chat tooltip should show only the key that works where I am (⌘N in the app, ⌥⌘N in a browser), not both.
2. Remember the narrowed list across reloads and across switching chats, so I don't have to narrow to billing-api again every time I come back.
