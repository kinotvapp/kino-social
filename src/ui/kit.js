// Small node builders shared by every view. Texts always come as [es, en] pairs.

export const isTv = (ctx) => ctx.device === "tv";

export const Txt = ([es, en], props = {}) => ({ type: "Text", text: es, textEn: en, ...props });
/** A text the person wrote: the same in both languages. */
export const Raw = (text, props = {}) => ({ type: "Text", text, textEn: text, ...props });

// Never surfaceVariant: it is the colour of the cards and comment bubbles the avatar sits on.
const AVATAR_COLORS = ["primaryContainer", "secondary", "primary"];

/** The person's avatar: the first letter of their name on a colour picked from their id. */
export function Avatar(user, radius = 20, props = {}) {
  const letter = (String(user.name || "?").trim().replace(/^@/, "")[0] || "?").toUpperCase();
  return {
    type: "CircleAvatar", text: letter, textEn: letter, radius,
    backgroundColor: AVATAR_COLORS[Math.abs(Number(user.id) || 0) % AVATAR_COLORS.length],
    labelText: user.name, labelTextEn: user.name, ...props,
  };
}

/** A bold name over «@ana · 5 min» (the handle, and when [time] is given, how long ago), then [extra]. */
export function NameBlock(user, extra = [], { time } = {}) {
  const meta = [
    ...(user.handle ? [Raw("@" + user.handle, { style: "caption", color: "muted", maxLines: 1 })] : []),
    ...(user.handle && time ? [Raw("·", { style: "caption", color: "muted" })] : []),
    ...(time ? [{ type: "Text", time, style: "caption", color: "muted" }] : []),
  ];
  return {
    type: "Column", flex: 1, gap: 0,
    children: [
      Raw(user.name || "", { style: "h5", bold: true, maxLines: 1 }),
      ...(meta.length ? [{ type: "Row", gap: 4, crossAxisAlignment: "center", children: meta }] : []),
      ...extra,
    ],
  };
}

export const Button = (label, onPressed, props = {}) => ({ type: "ElevatedButton", labelText: label[0], labelTextEn: label[1], onPressed, ...props });
export const TextBtn = (label, onPressed, props = {}) => ({ type: "TextButton", labelText: label[0], labelTextEn: label[1], onPressed, ...props });
export const IconBtn = (icon, label, onPressed, props = {}) => ({ type: "IconButton", icon, labelText: label[0], labelTextEn: label[1], onPressed, ...props });

/** The page's horizontal room: a phone edge to edge, a wide window centred. */
export const pagePadding = { compact: { x: 12, y: 12 }, medium: { x: 24, y: 12 }, expanded: { x: 32, y: 16 } };

export const count = (n) => (n > 999 ? Math.floor(n / 100) / 10 + "k" : String(n));
