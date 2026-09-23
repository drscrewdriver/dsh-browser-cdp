import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createServer } from "node:net";

//#region src/cdp/launcher.ts
const defaultIo = () => ({
	exists: (path) => existsSync(path),
	readFile: (path) => readFileSync(path, "utf8"),
	writeFile: (path, data) => {
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, data, "utf8");
	},
	removeFile: (path) => {
		try {
			rmSync(path);
		} catch {}
	},
	isAlive: (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	},
	killTree: (pid) => {
		if (process.platform === "win32") {
			try {
				spawn("taskkill", [
					"/PID",
					String(pid),
					"/T",
					"/F"
				], { stdio: "ignore" });
			} catch {}
			return;
		}
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	},
	spawn: (bin, args) => {
		const child = spawn(bin, args, {
			detached: true,
			stdio: "ignore"
		});
		child.unref();
		return { pid: child.pid ?? 0 };
	},
	fetchVersion: async (url) => {
		return { ok: (await fetch(url)).ok };
	},
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve$1) => setTimeout(resolve$1, ms)),
	makePort: async () => {
		const server = createServer();
		const port = await new Promise((resolve$1, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (address && typeof address === "object") resolve$1(address.port);
				else reject(/* @__PURE__ */ new Error("no port"));
			});
		});
		server.close();
		return port;
	}
});
const PLATFORM_CANDIDATES = {
	win32: [
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
		"C:/Program Files/Microsoft/Edge/Application/msedge.exe"
	],
	darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	linux: [
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser"
	]
};
function discoverChromeBinary(explicit, platform, exists) {
	if (explicit !== "") return exists(explicit) ? explicit : "";
	for (const candidate of PLATFORM_CANDIDATES[platform] ?? []) if (exists(candidate)) return candidate;
	return "";
}
/** Flags the user must never smuggle into the managed launch. */
const BLOCKED_ARGS = [
	"--user-data-dir",
	"--remote-debugging-port",
	"--remote-allow-origins",
	"--no-startup-window",
	"--proxy-server",
	"--headless"
];
function buildLaunchArgs(options) {
	const userArgs = (options.chromeArgs ?? "").split(/\s+/).map((arg) => arg.trim()).filter((arg) => arg !== "").filter((arg) => !BLOCKED_ARGS.some((blocked) => arg === blocked || arg.startsWith(`${blocked}=`) || arg.startsWith(`${blocked} `)));
	return [
		`--remote-debugging-port=${options.port}`,
		`--user-data-dir=${options.userDataDir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--remote-allow-origins=*",
		...options.headless ? ["--headless=new"] : [],
		...userArgs
	];
}
function defaultLauncherStatePath() {
	return join(homedir(), ".dsh", "cache", "dsh-browser-cdp", "launcher.json");
}
function defaultManagedProfileDir() {
	return join(homedir(), ".dsh", "cache", "dsh-browser-cdp", "chrome-profile");
}
function readRecord(path, io) {
	if (!io.exists(path)) return null;
	try {
		const parsed = JSON.parse(io.readFile(path));
		if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return null;
		return {
			pid: parsed.pid,
			port: parsed.port,
			userDataDir: typeof parsed.userDataDir === "string" ? parsed.userDataDir : "",
			endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "",
			startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0
		};
	} catch {
		return null;
	}
}
/**
* Launch (or reuse) the managed local browser. The readiness gate is the
* three-step check from T2.12: process alive → port responds → `/json/version`
* returns 200. `timeoutMs` bounds the readiness wait (default 20s).
*/
async function launchLocalBrowser(options, io) {
	const ioImpl = {
		...defaultIo(),
		...io ?? {}
	};
	const now = ioImpl.now;
	const sleep = ioImpl.sleep;
	const statePath = options.statePath ?? defaultLauncherStatePath();
	const record = readRecord(statePath, ioImpl);
	if (record && ioImpl.isAlive(record.pid) && (await ioImpl.fetchVersion(`http://127.0.0.1:${record.port}/json/version`)).ok) return {
		ok: true,
		reused: true,
		endpoint: record.endpoint,
		pid: record.pid,
		port: record.port
	};
	const platform = options.platform ?? process.platform;
	const bin = discoverChromeBinary(options.chromePath ?? "", platform, ioImpl.exists);
	if (bin === "") return {
		ok: false,
		code: "chrome-not-found",
		message: "No Chrome/Chromium/Edge binary found. Set chromePath in the settings panel."
	};
	const userDataDir = options.userDataDir && options.userDataDir !== "" ? options.userDataDir : defaultManagedProfileDir();
	const port = await ioImpl.makePort();
	const args = buildLaunchArgs({
		userDataDir,
		port,
		headless: options.localHeadless === true,
		chromeArgs: options.chromeArgs
	});
	let pid = 0;
	try {
		pid = ioImpl.spawn(bin, args).pid;
	} catch (error) {
		return {
			ok: false,
			code: "spawn-failed",
			message: String(error.message ?? error)
		};
	}
	if (!pid) return {
		ok: false,
		code: "spawn-failed",
		message: "spawn returned no pid"
	};
	const endpoint = `http://127.0.0.1:${port}`;
	const deadline = now() + (options.timeoutMs ?? 2e4);
	for (;;) {
		if (!ioImpl.isAlive(pid)) return {
			ok: false,
			code: "launch-exited",
			message: `chrome exited before opening the debugging port (pid ${pid})`
		};
		let versionOk = false;
		try {
			versionOk = (await ioImpl.fetchVersion(`${endpoint}/json/version`)).ok;
		} catch {}
		if (versionOk) break;
		if (now() >= deadline) {
			ioImpl.killTree(pid);
			ioImpl.removeFile(statePath);
			return {
				ok: false,
				code: "not-ready",
				message: `chrome did not answer ${endpoint}/json/version within the readiness window`
			};
		}
		await sleep(250);
	}
	ioImpl.writeFile(statePath, JSON.stringify({
		pid,
		port,
		userDataDir,
		endpoint,
		startedAt: now(),
		headless: options.localHeadless === true
	}, null, 2));
	return {
		ok: true,
		reused: false,
		endpoint,
		pid,
		port
	};
}
/**
* Stop the managed instance: kill-tree, wait for the pid to disappear, drop
* the registry entry. T2.14 — the reaper and plugin unmount both call this.
*/
async function stopLocalBrowser(options = {}, io) {
	const ioImpl = {
		...defaultIo(),
		...io ?? {}
	};
	const statePath = options.statePath ?? defaultLauncherStatePath();
	const record = readRecord(statePath, ioImpl);
	if (!record) return {
		ok: true,
		code: "not-running"
	};
	if (ioImpl.isAlive(record.pid)) {
		ioImpl.killTree(record.pid);
		const deadline = ioImpl.now() + (options.graceMs ?? 5e3);
		while (ioImpl.isAlive(record.pid) && ioImpl.now() < deadline) await ioImpl.sleep(100);
		if (ioImpl.isAlive(record.pid)) return {
			ok: false,
			code: "stop-timeout"
		};
	}
	ioImpl.removeFile(statePath);
	return {
		ok: true,
		code: "stopped"
	};
}
/** Is a managed local browser alive right now? (reaper + doctor helper) */
function localBrowserInfo(statePath, io) {
	const ioImpl = {
		...defaultIo(),
		...io ?? {}
	};
	const record = readRecord(statePath ?? defaultLauncherStatePath(), ioImpl);
	if (!record || !ioImpl.isAlive(record.pid)) return null;
	return {
		endpoint: record.endpoint,
		pid: record.pid
	};
}

//#endregion
export { launchLocalBrowser as a, discoverChromeBinary as i, defaultLauncherStatePath as n, localBrowserInfo as o, defaultManagedProfileDir as r, stopLocalBrowser as s, buildLaunchArgs as t };