import { config } from "../../package.json";

/**
 * LOOM integration module for Zotero Style
 * Bridges the Ethereal Style visual layer with the LOOM pipeline
 * (Actions & Tags plugin handles the automation side)
 */

// LOOM semantic tag → color map (matches PDF highlight colors from Actions & Tags action #1)
export const LOOM_TAG_COLORS: Record<string, string> = {
  "#claim": "#ffd400",
  "#evidence": "#ff6600",
  "#scope": "#a8d8ea",
  "#quote": "#e8b4b8",
  "#method": "#5fb236",
  "#definition": "#2ea8e5",
};

// Emoji prefixes used by LOOM tags (for nested tag recognition)
export const LOOM_EMOJI_PREFIXES = ["📁", "⏳", "🔴"];

// LOOM pipeline status levels (ordered by stage)
export interface LoomStatus {
  level: string;
  emoji: string;
  label: string;
  color: string;
}

const LOOM_STATUSES: Record<string, LoomStatus> = {
  woven:    { level: "woven",    emoji: "🟢", label: "Woven",        color: "#4caf50" },
  linked:   { level: "linked",   emoji: "🔵", label: "Linked",       color: "#2196f3" },
  ingested: { level: "ingested", emoji: "🟠", label: "Ingested",     color: "#ff9800" },
  needs:    { level: "needs",    emoji: "🔴", label: "Needs Notes",  color: "#f44336" },
  reading:  { level: "reading",  emoji: "🟡", label: "Reading",      color: "#ffc107" },
  none:     { level: "none",     emoji: "⬜", label: "Unprocessed",  color: "#9e9e9e" },
};

/**
 * Get the LOOM pipeline status for an item based on its tags.
 * Priority: woven > linked > ingested > needs-ai-notes > reading > none
 */
export function getLoomStatus(item: Zotero.Item, readingProgress?: number): LoomStatus {
  const tags = item.getTags().map(t => t.tag);
  if (tags.some(t => t.startsWith("⏳ woven"))) return LOOM_STATUSES.woven;
  if (tags.some(t => t.startsWith("⏳ linked"))) return LOOM_STATUSES.linked;
  if (tags.some(t => t.startsWith("⏳ ingested"))) return LOOM_STATUSES.ingested;
  if (tags.some(t => t.startsWith("🔴 needs"))) return LOOM_STATUSES.needs;
  if (readingProgress !== undefined && readingProgress > 0) return LOOM_STATUSES.reading;
  return LOOM_STATUSES.none;
}

/**
 * Get the LOOM route tag (📁 prefix) for an item.
 * Returns the route string (e.g., "01 Sovereignty") or empty string.
 */
export function getLoomRoute(item: Zotero.Item): string {
  const routeTag = item.getTags().find(t => t.tag.startsWith("📁"));
  return routeTag ? routeTag.tag.replace("📁 ", "") : "";
}

/**
 * Get semantic tags (#claim, #evidence, etc.) for an item.
 */
export function getSemanticTags(item: Zotero.Item): string[] {
  return item.getTags().map(t => t.tag).filter(t => t.startsWith("#"));
}

/**
 * Check if a tag is a LOOM emoji-prefixed tag.
 */
export function isLoomEmojiTag(tag: string): boolean {
  return LOOM_EMOJI_PREFIXES.some(prefix => tag.startsWith(prefix));
}

/**
 * Get a LOOM color for a semantic tag, or undefined if not a LOOM tag.
 */
export function getLoomTagColor(tag: string): string | undefined {
  return LOOM_TAG_COLORS[tag];
}

/**
 * Color-to-LOOM-tag reverse map (for annotation labels)
 */
export const COLOR_TO_LOOM_TAG: Record<string, string> = (function() {
  const map: Record<string, string> = {};
  const keys = Object.keys(LOOM_TAG_COLORS);
  for (let i = 0; i < keys.length; i++) {
    map[LOOM_TAG_COLORS[keys[i]]] = keys[i];
  }
  return map;
})();

/**
 * Export an item to Obsidian-compatible markdown.
 * Writes to PhDVault/00 Inbox/ with frontmatter matching the LOOM pipeline.
 */
export function exportToObsidian(item: Zotero.Item): { filename: string; content: string } {
  const title = item.getField("title") || "Untitled";
  const year = item.getField("date")?.match(/\d{4}/)?.[0] || "n.d.";
  const creators = item.getCreators();
  const firstCreator = creators[0];
  const author = firstCreator?.lastName || "Unknown";
  const citekey = `${author} ${year}`;
  const status = getLoomStatus(item);
  const route = getLoomRoute(item);
  const semanticTags = getSemanticTags(item);
  const doi = item.getField("DOI") || "";
  const url = item.getField("url") || "";
  const abstractNote = item.getField("abstractNote") || "";
  const pubTitle = item.getField("publicationTitle") || "";
  const tags = item.getTags().map(t => t.tag);

  // Get annotations from PDF attachments
  const pdfAttachments = item.getAttachments()
    .map((id: number) => Zotero.Items.get(id))
    .filter((a: any) => a.isAttachment() && a.attachmentContentType === "application/pdf");

  let annotations: { page: string; text: string; comment: string; color: string; loomTag: string }[] = [];
  for (const pdf of pdfAttachments) {
    for (const anno of pdf.getAnnotations()) {
      let pageIndex = "?";
      try {
        const pos = JSON.parse(anno.annotationPosition);
        pageIndex = (pos.pageIndex + 1).toString();
      } catch { }
      const loomTag = COLOR_TO_LOOM_TAG[anno.annotationColor] || "";
      annotations.push({
        page: pageIndex,
        text: anno.annotationText || "",
        comment: anno.annotationComment || "",
        color: anno.annotationColor || "",
        loomTag,
      });
    }
  }

  // Build tags list for frontmatter
  const allTags = [...new Set([...tags, ...semanticTags])];

  let md = `---
type: literature-note
citekey: "${citekey}"
zotero-key: ${item.key}
status: ${status.label}
route: "${route}"
tags:
${allTags.map(t => `  - "${t}"`).join("\n")}
created: ${new Date().toISOString().split("T")[0]}
---

# ${citekey} — ${title}

> [!meta] Metadata
> - **Authors:** ${creators.map(c => `${c.firstName} ${c.lastName}`).join(", ")}
> - **Publication:** ${pubTitle || "—"}
> - **Year:** ${year}
> - **DOI:** ${doi || "—"}
> - **URL:** ${url || "—"}
> - **LOOM Status:** ${status.emoji} ${status.label}
> - **Route:** ${route || "unrouted"}

`;

  if (abstractNote) {
    md += `> [!abstract] Abstract\n> ${abstractNote.split("\n").join("\n> ")}\n\n`;
  }

  md += `## Key Annotations\n`;

  if (annotations.length === 0) {
    md += "\n_No annotations yet._\n";
  } else {
    // Group by LOOM tag
    const grouped: Record<string, typeof annotations> = {};
    for (const anno of annotations) {
      const group = anno.loomTag || "other";
      (grouped[group] ??= []).push(anno);
    }
    const groupKeys = Object.keys(grouped);
    for (let gi = 0; gi < groupKeys.length; gi++) {
      const group = groupKeys[gi];
      const annos = grouped[group];
      if (group !== "other") {
        md += `\n### ${group}\n\n`;
      }
      for (const anno of annos) {
        md += `- (p.${anno.page}) "${anno.text}"`;
        if (anno.comment) md += `\n  > 💬 ${anno.comment}`;
        md += "\n";
      }
    }
  }

  md += `\n## Connections\n\n- \n`;

  const filename = `${author} ${year} — ${title}.md`;
  return { filename, content: md };
}

/**
 * Anthropology journal ranking data (for Publication Tags column)
 * Maps journal abbreviations to rank labels and colors
 */
export const ANTHRO_JOURNALS: Record<string, { rank: string; color: string }> = {
  "American Ethnologist":               { rank: "A*", color: "#d32f2f" },
  "American Anthropologist":            { rank: "A",  color: "#f57c00" },
  "Cultural Anthropology":              { rank: "A",  color: "#f57c00" },
  "Journal of the Royal Anthropological Institute": { rank: "A", color: "#f57c00" },
  "Social Analysis":                    { rank: "A",  color: "#f57c00" },
  "Comparative Studies in Society and History": { rank: "A", color: "#f57c00" },
  "Annual Review of Anthropology":      { rank: "A",  color: "#f57c00" },
  "Current Anthropology":               { rank: "A",  color: "#f57c00" },
  "Ethnos":                             { rank: "B",  color: "#388e3c" },
  "Journal of Material Culture":        { rank: "B",  color: "#388e3c" },
  "History and Anthropology":           { rank: "B",  color: "#388e3c" },
  "Anthropological Theory":             { rank: "B",  color: "#388e3c" },
  "Focaal":                             { rank: "B",  color: "#388e3c" },
  "Social Anthropology":                { rank: "B",  color: "#388e3c" },
  "Critique of Anthropology":           { rank: "B",  color: "#388e3c" },
  "Anthropology Today":                 { rank: "C",  color: "#1976d2" },
  "Journal of Contemporary Ethnography": { rank: "C", color: "#1976d2" },
  "Settler Colonial Studies":           { rank: "A",  color: "#f57c00" },
  "Postcolonial Studies":               { rank: "A",  color: "#f57c00" },
  "Native American and Indigenous Studies": { rank: "A", color: "#f57c00" },
  "Ethnohistory":                       { rank: "A",  color: "#f57600" },
  "The Western Historical Quarterly":   { rank: "B",  color: "#388e3c" },
  "Montana: The Magazine of Western History": { rank: "C", color: "#1976d2" },
};

/**
 * Get anthropology journal rank for a publication title.
 */
export function getAnthroRank(pubTitle: string): { rank: string; color: string } | undefined {
  if (!pubTitle) return undefined;
  // Exact match first
  if (ANTHRO_JOURNALS[pubTitle]) return ANTHRO_JOURNALS[pubTitle];
  // Case-insensitive partial match
  const lower = pubTitle.toLowerCase();
  const journalKeys = Object.keys(ANTHRO_JOURNALS);
  for (let ji = 0; ji < journalKeys.length; ji++) {
    const journal = journalKeys[ji];
    const info = ANTHRO_JOURNALS[journal];
    if (lower.includes(journal.toLowerCase()) || journal.toLowerCase().includes(lower)) {
      return info;
    }
  }
  return undefined;
}
