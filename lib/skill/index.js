import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

//#region src/skill/index.ts
/** skill 的运行时身份（系统提示与工具 description 里写死了这个名字，改这里不够）。 */
const SKILL_NAME = "bcdp-browser";
const SKILL_PROVIDER_NAME = "bcdp-browser-bundled-skill";
const SKILL_URL = new URL("../../skills/bcdp-browser/SKILL.md", import.meta.url);
const SKILL_RESOURCE_BASE = {
	kind: "directory",
	path: fileURLToPath(new URL("../../skills/bcdp-browser/", import.meta.url))
};
/** 随包发布的 skill 用 rank 600（同名去重时 rank 小者胜，用户自建可覆盖）。 */
const BUNDLED_SKILL_RANK = 600;
const SKILL_INVOCATION = {
	modelInvocable: true,
	userInvocable: true
};
const SKILL_FALLBACK_DESCRIPTION = "Recipes for operating a visible agent browser through the bcdp_* tools. Load before non-trivial browser work.";
/**
* 拆 frontmatter：只认扁平 `key: value`（值可带引号），认不出的行跳过。
* 开合分隔符按开头是 \n 还是 \r\n 定档、全程沿用同一种换行符——Windows
* checkout（git autocrlf）产出 CRLF 时不能把 YAML 头当正文喂给模型。
*/
function parseSkillDocument(source) {
	const newline = source.startsWith("---\r\n") ? "\r\n" : "\n";
	const opening = `---${newline}`;
	if (!source.startsWith(opening)) return {
		fields: {},
		body: source
	};
	const closing = `${newline}---${newline}`;
	const end = source.indexOf(closing, opening.length);
	if (end === -1) return {
		fields: {},
		body: source
	};
	const fields = {};
	for (const line of source.slice(opening.length, end).split(newline)) {
		const match = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line);
		if (match === null) continue;
		const value = match[2].trim().replace(/^(['"])([\s\S]*)\1$/u, "$2");
		if (value !== "") fields[match[1]] = value;
	}
	return {
		fields,
		body: source.slice(end + closing.length)
	};
}
/**
* 每次现读盘：改 SKILL.md 下一次发现就生效，不用重装插件。
* 读失败让它抛——宿主会 catch 并打 provider skipped 警告，比静默返回空目录好排查。
*/
async function loadSkillDocument(signal) {
	const { fields, body } = parseSkillDocument(await readFile(SKILL_URL, {
		encoding: "utf8",
		...signal ? { signal } : {}
	}));
	return {
		candidate: {
			name: SKILL_NAME,
			description: fields.description ?? SKILL_FALLBACK_DESCRIPTION,
			...fields.whenToUse !== void 0 ? { whenToUse: fields.whenToUse } : {},
			invocation: SKILL_INVOCATION,
			provider: SKILL_PROVIDER_NAME,
			source: "bundled",
			resourceBase: SKILL_RESOURCE_BASE,
			rank: BUNDLED_SKILL_RANK,
			locator: SKILL_URL,
			path: fileURLToPath(SKILL_URL),
			metadata: fields
		},
		content: body
	};
}
const skillProvider = {
	name: SKILL_PROVIDER_NAME,
	async list(options = {}) {
		const { candidate } = await loadSkillDocument(options.signal);
		return [candidate];
	},
	async get(selected, options = {}) {
		if (selected.name !== SKILL_NAME) return void 0;
		const { candidate, content } = await loadSkillDocument(options.signal);
		return {
			...candidate,
			content
		};
	}
};
const PROMPT_SECTION = [
	"A visible agent browser is available through the bcdp_* tools.",
	"In lazy mode only bcdp_help is resident — call it first; it returns the live backend, task space and unlocked tool batches.",
	"Load the `bcdp-browser` skill before non-trivial browser work, and treat the user's browser, tabs and logins as their own."
].join(" ");
const name = "bcdp-skill";
const inject = [];
function apply(ctx) {
	ctx.inject(["skills"], (skillCtx) => {
		skillCtx.skills.registerProvider(() => skillProvider);
	});
	ctx.inject(["systemPrompt"], (promptCtx) => {
		promptCtx.systemPrompt.section({
			name: "bcdp-browser",
			order: 150,
			text: PROMPT_SECTION
		});
	});
}

//#endregion
export { apply, inject, name, parseSkillDocument, skillProvider };