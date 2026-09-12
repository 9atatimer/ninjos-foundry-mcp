# Design records -- aspirational, frozen at APPROVED

One record per tool or package: `DESIGN.<name>.md`.

A record's body **freezes when a human marks it APPROVED**. After that,
only two things move: its status, and its append-only Key Decisions log
(each row citing the issue that authorized it).

When the code and an approved record disagree, **cut a defect; do not edit
the record**. Editing the spec to match what was built destroys the only
artifact that can show the drift.

Only a human marks a record IMPLEMENTED.

Process artifacts that live beside the records -- style guides, templates
-- have no approval lifecycle and evolve freely.
