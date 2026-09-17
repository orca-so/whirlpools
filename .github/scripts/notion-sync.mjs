#!/usr/bin/env node
// .github/scripts/notion-sync.mjs
//
// Syncs PR lifecycle events to the Notion Tasks database.
// Spec: "GitHub PR <-> Notion Tasks Sync"
//
// Events handled:
//   pull_request [opened, ready_for_review] -> link PR, status "Awaiting review",
//                                              create the review task (unassigned)
//   pull_request [review_requested]         -> assign the review task to the reviewer,
//                                              or create/reopen one for them
//   pull_request_review [submitted]         -> "Changes requested" | "Ready to merge",
//                                              complete the reviewer's review task
//   pull_request [closed] (merged)          -> "Completed" + date, cancel open review tasks
//
// No npm dependencies. Runs on the Node preinstalled on ubuntu-latest.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const NOTION_VERSION = "2025-09-03";

// Notion's built-in line checkmark, dark grey (#55534E). The filled-circle
// variant is `checkmark_gray.svg`.
const REVIEW_TASK_ICON = "https://www.notion.so/icons/checkmark-line_gray.svg";

const eventName = process.env.GITHUB_EVENT_NAME;
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const repoFull = process.env.GITHUB_REPOSITORY; // e.g. orca-so/kelpfarm

// GitHub handle -> Notion user ID
const userMap = JSON.parse(readFileSync(join(process.env.GITHUB_WORKSPACE, ".github", "notion-users.json"), "utf8"));

// ---------- HTTP helpers ----------

async function notion(endpoint, method = "GET", body) {
    const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${NOTION_TOKEN}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        throw new Error(`Notion ${method} ${endpoint} -> ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

async function github(endpoint, method = "GET", body) {
    const res = await fetch(`https://api.github.com${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        throw new Error(`GitHub ${method} ${endpoint} -> ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

// Post a PR comment at most once per (PR, key).
async function commentOnce(prNumber, key, message) {
    const marker = `<!-- notion-sync:${key} -->`;
    const comments = await github(`/repos/${repoFull}/issues/${prNumber}/comments?per_page=100`);
    if (comments.some((c) => c.body && c.body.includes(marker))) return;
    await github(`/repos/${repoFull}/issues/${prNumber}/comments`, "POST", {
        body: `${marker}\n${message}`
    });
}

// ---------- Notion helpers ----------

function taskNumberFromTitle(title) {
    const m = title.match(/EPD-(\d+)/i);
    return m ? Number(m[1]) : null;
}

function plainTitle(page) {
    return (page.properties.Name.title || []).map((t) => t.plain_text).join("");
}

async function findTaskByNumber(num) {
    const data = await notion(`/data_sources/${DATA_SOURCE_ID}/query`, "POST", {
        filter: { property: "ID", unique_id: { equals: num } },
        page_size: 1
    });
    return data.results[0] || null;
}

async function findReviewTasks(prUrl, { assigneeId, unassigned, openOnly } = {}) {
    const and = [
        { property: "PR", url: { equals: prUrl } },
        { property: "Type", select: { equals: "Review" } }
    ];
    if (assigneeId) {
        and.push({ property: "Assignee", people: { contains: assigneeId } });
    }
    if (unassigned) {
        and.push({ property: "Assignee", people: { is_empty: true } });
    }
    if (openOnly) {
        and.push({ property: "Status", status: { does_not_equal: "Completed" } });
        and.push({ property: "Status", status: { does_not_equal: "Cancelled" } });
    }
    const data = await notion(`/data_sources/${DATA_SOURCE_ID}/query`, "POST", {
        filter: { and }
    });
    return data.results;
}

function setStatus(pageId, name) {
    return notion(`/pages/${pageId}`, "PATCH", {
        properties: { Status: { status: { name } } }
    });
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

// Resolve the linked task from the PR title, commenting on the PR when it
// can't be found. Returns null when there is nothing to sync.
async function requireTask(pr) {
    const num = taskNumberFromTitle(pr.title);
    if (num == null) {
        await commentOnce(
            pr.number,
            "no-id",
            "No `EPD-<id>` found in the PR title, so this PR is not linked to a Notion task. " +
                "Add the task ID to the title; the sync re-runs on the next review event."
        );
        return null;
    }
    const task = await findTaskByNumber(num);
    if (!task) {
        await commentOnce(pr.number, "no-task", `No Notion task found with ID EPD-${num}.`);
        return null;
    }
    return task;
}

// Copy a relation property (Sprint, Project) from the original task.
function carryRelation(props, task, name) {
    const rel = task.properties[name]?.relation || [];
    if (rel.length) props[name] = { relation: rel.map((r) => ({ id: r.id })) };
}

// Create the review task for a PR, carrying over Sprint and Project from the
// original task, and append it to that task's Blockers. `notionUserId` may be
// null: the task is then created unassigned and claimed on review_requested.
async function createReviewTask(pr, task, notionUserId) {
    const props = {
        Name: {
            title: [
                { text: { content: "Review " } },
                { text: { content: `PR #${pr.number}`, link: { url: pr.html_url } } },
                { text: { content: `: ${plainTitle(task)}` } }
            ]
        },
        Type: { select: { name: "Review" } },
        Status: { status: { name: "Not started" } },
        PR: { url: pr.html_url }
    };
    if (notionUserId) props.Assignee = { people: [{ id: notionUserId }] };

    const created = await notion("/pages", "POST", {
        parent: { type: "data_source_id", data_source_id: DATA_SOURCE_ID },
        icon: { type: "external", external: { url: REVIEW_TASK_ICON } },
        properties: props
    });

    await carryOverRelations(created.id, task, pr);

    // Append the review task to the original task's Blockers.
    const blockers = (task.properties.Blockers?.relation || []).map((r) => ({ id: r.id }));
    blockers.push({ id: created.id });
    await notion(`/pages/${task.id}`, "PATCH", {
        properties: { Blockers: { relation: blockers } }
    });

    return created;
}

// Sprint and Project point at other data sources, so they are set in their own
// PATCH: if the integration can't reach those data sources Notion drops or
// rejects the value, and losing a relation beats losing the whole review task.
async function carryOverRelations(pageId, task, pr) {
    const props = {};
    carryRelation(props, task, "Sprint");
    carryRelation(props, task, "Project");
    const names = Object.keys(props);
    if (names.length === 0) {
        console.log(`Source task has no Sprint or Project to carry over`);
        return;
    }
    try {
        await notion(`/pages/${pageId}`, "PATCH", { properties: props });
        const after = await notion(`/pages/${pageId}`);
        const missing = names.filter((n) => !(after.properties[n]?.relation || []).length);
        if (missing.length === 0) {
            console.log(`Carried over ${names.join(", ")}`);
            return;
        }
        throw new Error(`${missing.join(", ")} came back empty after the update`);
    } catch (err) {
        console.error(`Could not set ${names.join(", ")} on the review task: ${err.message}`);
        await commentOnce(
            pr.number,
            "relation-not-copied",
            `The review task was created, but ${names.join(" and ")} could not be copied ` +
                "from the original task. Notion silently drops relations pointing at a data " +
                "source the integration cannot read \u2014 open the Sprints (and Projects) " +
                "database in Notion, and add this integration under Connections."
        );
    }
}

// Reopen a review task that was completed or cancelled on an earlier round.
function reopenReviewTask(pageId, notionUserId) {
    const properties = {
        Status: { status: { name: "Not started" } },
        Completed: { date: null }
    };
    if (notionUserId) properties.Assignee = { people: [{ id: notionUserId }] };
    return notion(`/pages/${pageId}`, "PATCH", { properties });
}

// ---------- Handlers ----------

async function onPrOpened(pr) {
    if (pr.draft) return;
    const task = await requireTask(pr);
    if (!task) return;
    await notion(`/pages/${task.id}`, "PATCH", {
        properties: {
            PR: { url: pr.html_url },
            Status: { status: { name: "Awaiting review" } }
        }
    });
    console.log(`Linked PR #${pr.number} to ${plainTitle(task)} -> Awaiting review`);

    // Every PR gets a review task, whether or not a reviewer was requested.
    // It stays unassigned until review_requested names someone. `ready_for_review`
    // can follow `opened` on the same PR, so only create one when none exists.
    const existing = await findReviewTasks(pr.html_url);
    if (existing.length === 0) {
        await createReviewTask(pr, task, null);
        console.log(`Created unassigned review task for PR #${pr.number}`);
    }
}

async function onReviewRequested(pr) {
    if (!event.requested_reviewer) return; // team review requests: out of scope v1
    const login = event.requested_reviewer.login;
    const task = await requireTask(pr);
    if (!task) return;

    const notionUserId = userMap[login];
    if (!notionUserId) {
        await commentOnce(
            pr.number,
            `no-mapping-${login}`,
            `@${login} has no Notion mapping in \`.github/notion-users.json\`, ` +
                "so the review task for this PR was left unassigned."
        );
        return; // the review task from PR open already covers this PR
    }

    // Reopen an existing review task for this PR + reviewer instead of duplicating.
    const mine = await findReviewTasks(pr.html_url, { assigneeId: notionUserId });
    if (mine.length > 0) {
        await reopenReviewTask(mine[0].id);
        console.log(`Reopened review task for @${login} on PR #${pr.number}`);
        return;
    }

    // Claim the unassigned task created when the PR opened. A second reviewer
    // finds none left to claim and gets their own task.
    const unclaimed = await findReviewTasks(pr.html_url, { unassigned: true });
    if (unclaimed.length > 0) {
        await reopenReviewTask(unclaimed[0].id, notionUserId);
        console.log(`Assigned review task on PR #${pr.number} to @${login}`);
        return;
    }

    await createReviewTask(pr, task, notionUserId);
    console.log(`Created review task for @${login} on PR #${pr.number}`);
}

// The latest verdict from each reviewer. GitHub keeps blocking a merge while any
// reviewer's most recent review is CHANGES_REQUESTED, so a second reviewer's
// approval must not clear the first reviewer's block. The incoming review is
// applied last: it is the newest, and the list endpoint may not have it yet.
async function latestVerdictByReviewer(prNumber, incoming) {
    const reviews = await github(`/repos/${repoFull}/pulls/${prNumber}/reviews?per_page=100`);
    const verdicts = new Map();
    for (const review of [...reviews, incoming]) {
        const state = review.state.toLowerCase();
        // A comment-only review carries no verdict, and a dismissed one has had its
        // verdict revoked; neither blocks nor approves.
        if (state === "commented" || state === "pending" || state === "dismissed") continue;
        verdicts.set(review.user.login, state);
    }
    return [...verdicts.values()];
}

async function onReviewSubmitted(pr, review) {
    const state = review.state.toLowerCase();
    if (state === "commented") return;

    const task = await requireTask(pr);
    if (task) {
        const verdicts = await latestVerdictByReviewer(pr.number, review);
        const newStatus = verdicts.includes("changes_requested") ? "Changes requested" : "Ready to merge";
        await setStatus(task.id, newStatus);
        console.log(`${plainTitle(task)} -> ${newStatus}`);
    }

    // Complete this reviewer's review task.
    const notionUserId = userMap[review.user.login];
    let reviewTasks = notionUserId
        ? await findReviewTasks(pr.html_url, { assigneeId: notionUserId, openOnly: true })
        : [];
    if (reviewTasks.length === 0) {
        // Reviewed without a formal request, or the reviewer isn't mapped: close out
        // the unassigned task created when the PR opened.
        reviewTasks = await findReviewTasks(pr.html_url, { unassigned: true, openOnly: true });
    }
    for (const rt of reviewTasks) {
        await notion(`/pages/${rt.id}`, "PATCH", {
            properties: {
                Status: { status: { name: "Completed" } },
                Completed: { date: { start: today() } }
            }
        });
    }
}

async function onPrMerged(pr) {
    const task = await requireTask(pr);
    if (task) {
        await notion(`/pages/${task.id}`, "PATCH", {
            properties: {
                Status: { status: { name: "Completed" } },
                Completed: { date: { start: today() } }
            }
        });
        console.log(`${plainTitle(task)} -> Completed`);
    }

    // Cancel any review tasks still open for this PR.
    const open = await findReviewTasks(pr.html_url, { openOnly: true });
    for (const rt of open) {
        await setStatus(rt.id, "Cancelled");
    }
}

// A PR closed without merging leaves review tasks pointing at work that will
// never land, so cancel them. The main task is deliberately left alone: a PR
// closed to split, supersede or rebase the work is still in progress, and only
// a human knows which of those happened.
async function onPrClosedUnmerged(pr) {
    const open = await findReviewTasks(pr.html_url, { openOnly: true });
    for (const rt of open) {
        await setStatus(rt.id, "Cancelled");
    }
    console.log(`PR #${pr.number} closed unmerged -> cancelled ${open.length} review task(s)`);
}

// ---------- Entry ----------

async function main() {
    const pr = event.pull_request;
    if (!pr) return;

    if (eventName === "pull_request") {
        if (["opened", "ready_for_review"].includes(event.action)) return onPrOpened(pr);
        if (event.action === "review_requested") return onReviewRequested(pr);
        if (event.action === "closed") return pr.merged ? onPrMerged(pr) : onPrClosedUnmerged(pr);
    }
    if (eventName === "pull_request_review" && event.action === "submitted") {
        return onReviewSubmitted(pr, event.review);
    }
}

main().catch((err) => {
    // A failed sync shows up in the Actions tab but never blocks the PR,
    // as long as this workflow is not made a required status check.
    console.error(err);
    process.exit(1);
});
