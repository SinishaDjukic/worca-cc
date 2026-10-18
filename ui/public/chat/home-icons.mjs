// ui/public/chat/home-icons.mjs — now a re-export: the chat home keeps its imports, the set lives in ../icons.mjs.
import { ICONS, icon } from '../icons.mjs';
export const HOME_ICONS = ICONS;
/** A `span.chat-ic` holding icon `name` at `size` px. */
export const homeIcon = (doc, name, size = 16) => icon(doc, name, size, 'chat-ic');
