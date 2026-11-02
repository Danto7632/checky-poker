// English UI strings. Source of truth for copy: 07-design/ui-spec.md (key names and en values copied verbatim).
//
// Constraints that shape this file:
// - No imports and erasable TypeScript only: frontend/scripts/scan-dist.mjs imports it directly with Node's type
//   stripping to scan every value for currency symbols and banned words (scan rules S5/S6).
// - Keys use dot notation. `err.<CODE>` / `notice.<CODE>` are the canonical keys for contract codes (C11); the ui-spec
//   screen keys (`act.err.notYourTurn`, `gate.minor.title`, ...) are aliases holding the same string. The alias pairs
//   are checked in __tests__/i18n-codes.test.ts so they cannot drift apart.
// - `{x}` placeholders are filled by useT with already formatted values (Intl), never raw numbers.
// - Keys marked "§D" are not in ui-spec yet (listed in 08-impl-notes/frontend.md for Jonnathan).
export const en = {
  // ---- shell ------------------------------------------------------------------------------------------------
  'brand.name': 'Checky Poker', // §D
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.listSep': ', ', // §D (joins card names and screen-reader fragments)
  'footer.disclosure': 'Play money only — no cash value · Not gambling · 18+',
  'lang.name.en': 'English', // §D (endonym, same in every UI language)
  'lang.name.ja': '日本語', // §D
  'storage.unavailable':
    "This browser isn't letting Checky Poker save data (private mode or storage turned off). You can still play, but hands won't be kept.",
  'notFound.title': "This page doesn't exist",
  'notFound.cta': 'Go home',
  'boot.title': "Checky Poker couldn't start",
  'boot.body':
    'Your browser may be out of date or blocking scripts. Update it or try another browser, then reload.',
  'boot.reload': 'Reload', // §D (X-01 boot failure button; same word as gate.minor.reload)
  'fail.details': 'Details',
  'fail.copyDiag': 'Copy diagnostics',

  // ---- gate (G-01, G-02, G-03) -----------------------------------------------------------------------------
  'gate.title': 'Before you play',
  'gate.dest.join': "You're joining a friend's room",
  'gate.dest.replay': "You're opening a shared hand",
  'gate.dest.practice': "You're starting a practice game",
  'gate.dest.arena': "You're about to watch bots play",
  'gate.item.age': 'For adults 18 and over.',
  'gate.item.chips':
    "Chips are play money. They have no cash value and can't be bought, sold, exchanged or given to anyone.",
  'gate.item.noMoney': 'Never bet real money on a game here.',
  'gate.item.notGambling': "This is not gambling. It's a free game to play with friends.",
  'gate.cta.adult': "I'm 18 or older — continue",
  'gate.cta.minor': "I'm under 18",
  'gate.storageWarn':
    "This browser isn't letting Checky Poker save everything (private mode or storage turned off), so next time we may ask again and your hand history and settings may not be kept.",
  'gate.minor.title': 'Checky Poker is for adults',
  'gate.minor.body':
    'You need to be 18 or older to play. Nothing was saved — if you chose this by mistake, reload the page.',
  'gate.minor.reload': 'Reload',
  'gate.adult.title': 'One more step',
  'gate.adult.continue': 'Continue',

  // ---- profile (P-01, S-01) --------------------------------------------------------------------------------
  'profile.title': 'What should we call you?',
  'profile.nickname': 'Nickname',
  'profile.hint': '1–16 characters. Shown at the table.',
  'profile.privacy': 'Saved only in this browser. No account.',
  'profile.shuffle': 'Shuffle avatar',
  'profile.continue': 'Continue',
  'profile.err.empty': 'Enter a nickname.',
  'profile.err.spaces': "A nickname can't be only spaces.",
  'profile.err.long': 'Use 16 characters or fewer.',

  // ---- home (H-01) -----------------------------------------------------------------------------------------
  'home.hi': 'Hi, {name}',
  'home.edit': 'Edit',
  'home.practice.title': 'Practice',
  'home.practice.body': 'Play house bots right now. No key needed, works offline.',

  // ---- settings (S-01) -------------------------------------------------------------------------------------
  'settings.title': 'Settings',
  'settings.profile': 'Profile',
  'settings.profile.note': 'Changes apply from the next room you join.',
  'settings.language': 'Language',
  'settings.saved': 'Saved',

  // ---- practice setup (PR-01) ------------------------------------------------------------------------------
  'practice.title': 'Practice',
  'practice.bots': 'Bots',
  'practice.style': 'Bot style',
  'practice.turn': 'Time per turn',
  'practice.turn.none': 'No limit',
  'practice.turn.none.help': 'Take as long as you need. Bots still play at their usual pace.',
  'practice.liveOdds': 'Show live odds',
  'practice.offline': 'Works offline once this page has loaded.',
  'practice.cta': 'Deal me in',
  'practice.crash.title': 'The practice table stopped unexpectedly',
  'practice.crash.body': 'The game engine in this tab stopped. Start again to keep playing.',
  'practice.crash.cta': 'Start again',
  'create.turn.opt': '{s}s',
  'create.turn.opt.sr': '{s} seconds',
  'style.balanced': 'Balanced',
  'style.aggressive': 'Aggressive',
  'style.tight': 'Tight',

  // ---- table (T-01) ----------------------------------------------------------------------------------------
  'table.leave': 'Leave',
  'table.roomChip.practice': 'Practice · {sb}/{bb}',
  'table.menu.open': 'Open table menu',
  'table.yourTurn': 'Your turn',
  'table.secondsLeft': '{s}s',
  'table.toCall': 'To call {n}',
  'table.pot': 'Pot',
  'table.fold': 'Fold',
  'table.check': 'Check',
  'table.call': 'Call {n}',
  'table.bet': 'Bet…',
  'table.raise': 'Raise…',
  'table.sitout.body': "You're sitting out. Your chips are kept.",
  'table.sitIn': 'Sit back in',
  'table.paused.self': 'Paused',
  'table.pausing': 'Pausing before the next hand',
  'table.pauseCancelled': 'Pause cancelled',
  'table.waitingPlayers': 'Waiting for players',
  'table.nextHand': 'Next hand in {s}',
  'table.pause': 'Pause',
  'table.resume': 'Resume',
  'table.keepPlaying': 'Keep playing',
  'table.sr.turn': 'Your turn. To call {n}.', // §D (TableAnnouncer, ui-spec T-01 interaction sample)
  'table.sr.secondsLeft': '{s} seconds left', // §D (assertive 5-second warning)
  'table.sr.action': '{name}: {action}', // §D (other seats' actions, polite)
  'sizer.min': 'Min {n}',
  'sizer.halfPot': '½ pot',
  'sizer.threeQuarterPot': '¾ pot',
  'sizer.pot': 'Pot',
  'sizer.allIn': 'All-in {n}',
  'sizer.amount': 'Amount',
  'sizer.confirm.raise': 'Raise to {n}',
  'sizer.confirm.bet': 'Bet {n}',
  'sizer.confirm.allIn': 'All-in {n}',
  'sizer.back': 'Back',
  'sizer.err.min': 'Minimum raise is {n}.',
  'sizer.err.minBet': 'Minimum bet is {n}.',
  'sizer.err.digits': 'Enter numbers only.', // §D (BetSizer: text other than digits, review M3)
  'sizer.clampAllIn': "That's all your chips — All-in.",
  'act.err.notYourTurn': "It's not your turn.",
  'act.err.illegal': "That move isn't allowed right now.",
  'act.sending': 'Sending…',
  'act.timeout.check': 'Time ran out — you checked.',
  'act.timeout.fold': 'Time ran out — you folded.',
  'pre.checkFold': 'Check/Fold',
  'pre.checkFold.hint': "Checks if it can, folds if it can't.",
  'seat.you': 'You',
  'seat.folded': 'Folded',
  'seat.allIn': 'All-in',
  'seat.sittingOut': 'Sitting out',
  'seat.reconnecting': 'Reconnecting…',
  'seat.joinsNext': 'Joins next hand',
  'seat.thinking': 'Thinking…',
  'seat.open': 'Open seat',
  'seat.sr': 'Seat {n}, {name}, {chips} chips{status}',
  'seat.sr.toAct': ', to act',
  'seat.sr.left': ', {s} seconds left',
  'bot.houseName': 'House {n}',
  'bot.badge.house': 'House',
  'odds.win': 'Win chance',
  'odds.vs': 'vs {n} random hands',
  'odds.potOdds': 'Pot odds',
  'odds.needed': 'Needed to call',
  'odds.value.exact': '{v}%',
  'odds.value.mc': '≈{v}%',
  'odds.exact': 'Exact', // reserved: not rendered (T2-005, exact shows no badge)
  'odds.estimate': 'Estimate ±{hw}%',
  'odds.estimate.noHw': 'Estimate',
  'odds.sr.exact': '{v} percent, exact',
  'odds.sr.mc': 'about {v} percent, estimate, usually within {hw} points',
  'odds.sr.mcNoHw': 'about {v} percent, estimate',
  'odds.exact.tip': 'Counted over every remaining board.', // reserved: not rendered (T2-005)
  'odds.estimate.tip': 'Estimated from {samples} random boards — usually within ±{hw} points.',
  'leave.title': 'Leave the table?',
  'leave.body':
    'Your hand will be folded and your seat opens up. If you come back, you start again with {chips} chips.',
  'leave.allIn': "You're all-in, so you stay in this pot until it's decided.",
  'leave.stay': 'Stay',
  'leave.cta': 'Leave',

  // ---- cards and hand ranks (ui-spec 0.6) ------------------------------------------------------------------
  'card.label': '{rank} of {suit}',
  'card.suit.s': 'spades',
  'card.suit.h': 'hearts',
  'card.suit.d': 'diamonds',
  'card.suit.c': 'clubs',
  'card.back': 'Face-down card',
  'board.label': 'Board: {cards}',
  'board.empty': 'Board: no cards yet',
  // Key names follow the contract RankCode (AF-10): trips <- ui-spec three_of_a_kind, quads <- four_of_a_kind.
  'rank.high_card': '{r1} high',
  'rank.pair': 'Pair of {rs1}',
  'rank.two_pair': 'Two pair, {rs1} and {rs2}',
  'rank.trips': 'Three of a kind, {rs1}',
  'rank.straight': 'Straight, {r1} high',
  'rank.flush': 'Flush, {r1} high',
  'rank.full_house': 'Full house, {rs1} full of {rs2}',
  'rank.quads': 'Four of a kind, {rs1}',
  'rank.straight_flush': 'Straight flush, {r1} high',
  'rank.royal_flush': 'Royal flush',
  'rank.r.A': 'Ace',
  'rank.r.K': 'King',
  'rank.r.Q': 'Queen',
  'rank.r.J': 'Jack',
  'rank.r.T': '10',
  'rank.r.9': '9',
  'rank.r.8': '8',
  'rank.r.7': '7',
  'rank.r.6': '6',
  'rank.r.5': '5',
  'rank.r.4': '4',
  'rank.r.3': '3',
  'rank.r.2': '2',
  'rank.rs.A': 'Aces',
  'rank.rs.K': 'Kings',
  'rank.rs.Q': 'Queens',
  'rank.rs.J': 'Jacks',
  'rank.rs.T': '10s',
  'rank.rs.9': '9s',
  'rank.rs.8': '8s',
  'rank.rs.7': '7s',
  'rank.rs.6': '6s',
  'rank.rs.5': '5s',
  'rank.rs.4': '4s',
  'rank.rs.3': '3s',
  'rank.rs.2': '2s',

  // ---- result (T-02 HandResult) ----------------------------------------------------------------------------
  'result.main': 'Main pot {n} → {winners}',
  'result.side': 'Side pot {n} → {winners}',
  'result.returned': 'Returned {n} → {name} (not called)',
  'result.split': 'Split',
  'result.wins': '{name} wins {n}',
  'result.handRank': '{rank}',
  'result.noShowdown': "No showdown — people's cards stay hidden.",
  'action.check': 'Checked',
  'action.call': 'Called {n}',
  'action.bet': 'Bet {n}',
  'action.raise': 'Raised to {n}',
  'action.fold': 'Folded',
  'action.allIn': 'All-in {n}',

  // ---- table menu (T-05, practice sections) ----------------------------------------------------------------
  'menu.room': 'Room',
  // ui-spec uses `menu.blinds` for both this info line and the host's "Change blinds" (§D collision note for 2-3).
  'menu.blinds': 'Blinds {sb}/{bb}',
  'menu.stack': 'Starting chips {chips}',
  'menu.turn': 'Time per turn {s}s',
  'menu.turn.none': 'Time per turn: No limit',
  'menu.noCash': 'Chips are play money — no cash value',
  'menu.game': 'Game',
  'menu.liveOdds': 'Live odds',
  'menu.chatter': 'Bot chatter',
  'menu.chatter.on': 'Bots talk at the table',
  'menu.chatter.off': 'Bots stay quiet',
  'menu.pause': 'Pause after this hand',
  'menu.resume': 'Resume',
  'menu.you': 'You',
  'menu.leave': 'Leave table',
  'menu.help': 'Help',
  'menu.shortcuts': 'Keyboard shortcuts',

  // ---- refill (T-06) ---------------------------------------------------------------------------------------
  'refill.title': 'Out of chips',
  'refill.body': 'Get {chips} chips again — free, as many times as you like.',
  'refill.cta': 'Get chips again',
  'refill.done': 'You have {chips} chips.',
  'refill.missed': "You're sitting out until you get chips.",

  // ---- engine invariant (X-01) — wording per contract MA-R1-06 / p1 change note section 3 (Jonnathan follow-up) --
  'invariant.title': 'Something went wrong, so we voided this hand',
  'invariant.body':
    'Chips are back to where they were at the start of the hand and the game is paused. You can resume. If you can, report it on GitHub with the diagnostics.',

  // ---- notices.v1 (13) -------------------------------------------------------------------------------------
  'notice.N-BLINDS-NEXT': 'Blinds {sb}/{bb} from the next hand',
  'notice.N-CLOSING-AFTER-HAND': 'The host will close the room after this hand.',
  'notice.N-PAUSED': 'Paused by the host',
  'notice.N-RESUMED': 'The host resumed the game.',
  'notice.N-KICKED': 'The host removed you from this room',
  'notice.N-OTHER-TAB': 'This room is open in another tab',
  'notice.N-BOT-NEXT-HAND': '{name} joins from the next hand.',
  'notice.N-BOT-NEXT-HAND.remove': '{name} leaves after this hand.',
  'notice.N-BOT-NEXT-HAND.update': '{name} changes from the next hand.',
  'notice.N-SETTINGS': 'Live odds turned on — everyone sees only their own.',
  'notice.N-SETTINGS.liveOff': 'Live odds turned off.',
  'notice.N-SETTINGS.chatterOff': 'Bots will stay quiet.',
  'notice.N-SETTINGS.chatterOn': 'Bots can talk again.',
  'notice.N-SITOUT-STRIKES': "You timed out 3 times in a row, so you're sitting out.",
  'notice.N-LLM-CAP': 'AI call limit reached ({cap}). Bots now use house rules.',
  'notice.N-LLM-KEY': '{provider} rejected your key, so {name} now uses house rules. Check your key in Settings.',
  'notice.N-HOST-ISOLATED': "You're offline. If you don't reconnect within {s} seconds, the room ends for everyone.",
  'notice.N-REFILL-HINT': 'Out of chips',

  // ---- errors.v1, surface != silent (53). Each value is the ui-spec string of the screen key in the comment. ----
  'err.E-ACT-AMOUNT': 'Minimum raise is {n}.', // sizer.err.min
  'err.E-ACT-ILLEGAL': "That move isn't allowed right now.", // act.err.illegal
  'err.E-ACT-NOT-YOUR-TURN': "It's not your turn.", // act.err.notYourTurn
  'err.E-CHAT-BLOCKED': "You can't send messages in this room.", // chat.err.blocked
  'err.E-CHAT-RATE': 'Wait a moment before sending again.', // chat.err.rate
  'err.E-CHAT-TOO-LONG': 'Messages can be up to 200 characters.', // chat.err.long
  'err.E-COACH-FILTERED': "Some sentences had numbers that didn't match the calculation, so we removed them.", // coach.filtered
  'err.E-COACH-MOSTLY-FILTERED': "The explanation didn't match the numbers, so we hid it. Try again.", // coach.mostly
  'err.E-ENG-INVARIANT': 'Something went wrong, so we voided this hand', // invariant.title
  'err.E-GATE-UNDERAGE': 'Checky Poker is for adults', // gate.minor.title
  'err.E-JOIN-CODE-FORMAT': "That code has a character we don't use. Codes use 2–9 and letters except I, L and O.", // home.code.err.chars
  'err.E-JOIN-FULL': 'This room is full', // R-05 full
  'err.E-JOIN-KICKED': 'The host removed you from this room', // R-05 kicked
  'err.E-JOIN-LOCKED': 'The host closed this room to new players', // R-05 locked
  'err.E-JOIN-OTHER-TAB': 'This room is open in another tab', // R-05 other_tab
  'err.E-JOIN-VERSION': 'You and the host are on different versions', // R-05 version
  'err.E-KEY-STORAGE': "This browser won't let us save the key. It works until you close this tab.", // keys.err.storage
  'err.E-LLM-AUTH': 'That key was rejected. Check that you copied the whole key.', // keys.err.auth
  'err.E-LLM-CAP': 'AI call limit reached ({cap}). Bots now use house rules.', // N-LLM-CAP banner
  'err.E-LLM-FORBIDDEN': "This key can't use this model. Check model access or your region in the provider console.", // keys.err.forbidden
  'err.E-LLM-LOCAL-BLOCKED': 'The browser or Ollama blocked the request. Check both steps above.', // local.err
  'err.E-LLM-NETWORK': "Couldn't reach the provider. Check your connection or blocker extensions.", // keys.err.network
  'err.E-LLM-NO-KEY': 'Add an AI key first', // addSeat.ai.noKey
  'err.E-LLM-RATE': 'The provider reports a usage limit or billing problem. Check your provider console.', // keys.err.rate
  'err.E-LLM-SERVER': 'The provider is having problems. Try again in a few minutes.', // keys.err.server
  'err.E-LLM-TIMEOUT': 'The provider took more than 10 seconds to answer.', // keys.err.timeout
  'err.E-NET-HOST-GONE': "The host didn't come back, so the room ended", // closed.title.host_lost
  'err.E-NET-HOST-LOST': "The host's connection dropped", // hostLost.title
  'err.E-NET-HOST-NOT-FOUND': "Can't find this room", // fail.room
  'err.E-NET-ICE-FAILED': 'This network blocks direct connections', // fail.direct
  'err.E-NET-OFFLINE': "You're offline. Reconnecting when the network is back.", // table.offline
  'err.E-NET-RELAY-REGISTER': "Can't reach the public connection helpers", // fail.relay
  'err.E-NET-RELAY-UNREACHABLE': "Can't reach the public connection helpers", // fail.relay
  'err.E-NET-SEAT-TIMEOUT': "The host didn't answer", // fail.seat
  'err.E-PROFILE-NICK-INVALID': '1–16 characters. Shown at the table.', // profile.hint
  'err.E-PROJ-ARENA-DENIED': "The bots-only view isn't available in this room.", // arena.denied
  'err.E-ROOM-SEATS-FULL': 'All seats are taken.', // err.seatsFull (T-04)
  'err.E-ROOM-START-MIN-PLAYERS': 'Needs 2 players with chips — bots count.', // invite.start.disabled
  'err.E-SHR-CORRUPT': 'This link is damaged', // linkErr.corrupt.title
  'err.E-SHR-NEWER': 'This link was made with a newer version', // linkErr.newer.title
  'err.E-SHR-TOO-LONG': 'This link is long and may get cut off in some messengers.', // share.long
  'err.E-SHR-UNSUPPORTED': "This browser can't open shared hands", // linkErr.unsupported.title
  'err.E-STO-BLOCKED': 'An older Checky Poker tab is open. Close other tabs and reload.', // storage.blocked
  'err.E-STO-IMPORT-CORRUPT': "The file is damaged and couldn't be read.", // data.import.err.corrupt
  'err.E-STO-IMPORT-FORMAT': "This file isn't a Checky Poker export.", // data.import.err.format
  'err.E-STO-IMPORT-NEWER': 'This file is from a newer version. Reload the page to update, then import again.', // data.import.err.newer
  'err.E-STO-QUOTA': 'Storage is full. Export your history, then free up browser storage.', // storage.quota
  'err.E-STO-UNAVAILABLE':
    "This browser isn't letting Checky Poker save data (private mode or storage turned off). You can still play, but hands won't be kept.", // storage.unavailable
  'err.E-STO-WIPE-FAILED': "Some data couldn't be deleted. Close other Checky Poker tabs and try again.", // wipe.err
  'err.E-UI-BOOT': "Checky Poker couldn't start", // boot.title
  'err.E-UI-CLIPBOARD': "Couldn't copy. The link is selected — copy it yourself.", // invite.clipboardFail
  'err.E-UI-NOT-FOUND': "This page doesn't exist", // notFound.title
  'err.E-WORKER-CRASH': 'The practice table stopped unexpectedly', // practice.crash.title
};

export type MessageKey = keyof typeof en;
