# NPC Dialog

> **Phase:** 1 -- CONCEPT. Unfunded, non-binding, not a design record.
> **Date:** 2026-09-12 **Author:** Niclas (captured with AI assistance)

## The idea

Give the AI its own login to the game. Log it in as that user, let it use the
GM's ability to speak as an Actor, and have it hold conversations in character
with the players. A sub-agent plays the part of each notable NPC.

The moment being chased is the players' reaction. In the human's words: "and
then they shit their pants." Not a chatbot bolted to the side of the game -- the
innkeeper answers you, the lizardman warns you off the eggs, and it comes
through the ordinary chat log looking like any other NPC line, because it is
one.

Why sub-agents rather than one voice: notable NPCs are not interchangeable. The
innkeeper and the bandit lord want different things, know different things, and
should not sound alike or share what they know. One agent per NPC is the
natural shape of that.

This grew out of a narrower question -- whether the AI could watch the chat log
and start talking when a player logged in. It widened once it was clear that
speaking _as an actor_ was available, not just speaking as itself.

## Story sets

| File                    | Theme                                                  |
| ----------------------- | ------------------------------------------------------ |
| STORIES.at-the-table.md | what a player and a GM actually experience during play |
| STORIES.the-npc.md      | what an NPC is, knows, remembers, and may say          |

## Notes

**Settled in session.** The AI gets its own user account rather than sharing
the GM's. It speaks as Actors, not as itself. One sub-agent per notable NPC.

**Still open.** Whether the players are told. Which NPCs are "notable" enough
to get an agent. Whether the GM sees a line before it posts or only after.
What an NPC is allowed to know -- its own knowledge, or everything in the
world. Whether an NPC persists between sessions or is rebuilt each time.
Whether players can address an NPC directly, or only speak in the room and let
it decide to answer.

**Spike findings, 2026-09-12.** Evidence that parts of this are reachable, not
a design and not a commitment:

- Speaking as an Actor works from outside the client. A message posted with an
  Actor as its speaker appears in the log under that Actor's name, indistinguishable
  from a GM doing it by hand.
- Waiting for a player to speak does not require polling. It is possible to
  block until a real chat message arrives and be woken only then -- measured at
  3.0s of genuine waiting, resolved by an actual message. That matters because
  the cost of this idea is per-utterance rather than per-tick.
- The AI's account has to be a full Gamemaster, not an Assistant. Foundry's
  `isGM` is true only for role 4, and the bridge checks it. An Assistant login
  can chat but cannot bridge.
- The MCP server has no chat surface at all today -- none of its 79 tools read
  or write chat. Today this runs by driving a browser session. Whether that
  stays true is a phase 2 question.

**Leans on things that do not exist yet.** A dedicated user record for the AI.
Some way for a sub-agent to be handed only what its NPC knows. Nothing exists
for either.
