// The module registry. Each module adds exactly one import line and one array
// entry here (keep both alphabetical); a merge conflict in this file is expected
// and trivial. agentos.ts reads MODULES for migrations, dispatch and help.
import type { Module } from "./types";
import { body } from "./body";
import { bounty } from "./bounty";
import { brain } from "./brain";
import { cabinet } from "./cabinet";
import { clients } from "./clients";
import { content } from "./content";
import { demand } from "./demand";
import { doctrine } from "./doctrine";
import { growth } from "./growth";
import { mind } from "./mind";
import { mission } from "./mission";
import { mods } from "./mods";
import { money } from "./money";
import { people } from "./people";
import { price } from "./price";
import { ribbon } from "./ribbon";
import { runbooks } from "./runbooks";
import { scan } from "./scan";
import { soul } from "./soul";
import { thumbs } from "./thumbs";
import { weather } from "./weather";
import { work } from "./work";

export const MODULES: Module[] = [
  body, // `agentos body`: Body: workouts, sets, recovery, meals, looks scans and protocols (v2)
  bounty, // `agentos bounty`: automation bounties priced from recurring work, and the monthly payroll
  brain, // `agentos brain`: Brain: the second brain (notes, inbox, people files, links) beside the brain vault (v2)
  cabinet, // `agentos cabinet`: weekly cabinet sessions, advocates and outcomes (planning group)
  clients, // `agentos clients`: client window (public page per client, decisions they answer)
  content, // `agentos content`: Content OS (ideas, scripts, shoot days, edits, posts) in content.db beside agentos.db
  demand, // `agentos demand`: demand radar (asks clustered across clients, product candidates)
  doctrine, // `agentos doctrine`: weekly observations with evidence, accepted into planner rules
  growth, // `agentos growth`: Growth: journal entries, Sunday reviews, dreams, plans (v2)
  mind, // `agentos mind`: Mind: screen time, books and reading sessions, courses and lessons, the evening check-in (v2)
  mission, // `agentos mission`: Mission: purpose, goal milestones, horizon notes (goals themselves stay core) (v2)
  mods, // `agentos mods`: the registry itself (list the modules, check their migrations)
  money, // `agentos money`: Money: accounts, transactions, budgets, income sources, leaks, net worth, funds (v2)
  people, // `agentos people`: People: persons, moments, plans, rhythms and dates for Family, Friends and Romance (v2)
  price, // `agentos price`: rupees an hour per area, typed by the user (planning group)
  ribbon, // `agentos ribbon`: what the PC saw today, by area and project (Reality ribbon)
  runbooks, // `agentos runbooks`: runbooks assembled from tasks done twice with evidence
  scan, // `agentos scan`: what the lens read (shares, camera, voice) and where it was filed (v2)
  soul, // `agentos soul`: Soul: habits and check-ins, the Clean streak, urges, blocker rules, values (v2)
  thumbs, // `agentos thumbs`: taps per screen and the monthly UI proposals
  weather, // `agentos weather`: the week simulated 1000 times from the user's history (planning group)
  work, // `agentos work`: Work: the night shift's rows and the review marks from the Changes page (v2)
];
