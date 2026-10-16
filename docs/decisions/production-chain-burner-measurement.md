# Candidate-local burner accounting

The host carries the planner's selected fuel name into immutable stage requirements
and exact reconstructed-unit bindings. Lua checks the installed item and burner
prototypes before admission. This first supported envelope requires normal quality,
effectivity one, no burnt residue, a declared external fuel source and fuel energy
greater than burner heat capacity plus maximum per-tick consumption. Unsupported
cases fail before speed/pause changes. Planning can still represent other fuel
behavior; that does not establish workshop measurement support.

Inventory removal counts a whole item at ignition, while part of its energy remains
available afterward. Observe `remaining_burning_fuel + heat` on every game tick.
Within the declared bound, an energy rise identifies at most one new fuel item;
consumption is previous energy plus that item's energy minus current energy.
Consumption outside the installed per-tick bound, mismatched fuel, missed ticks or
unexplained same-tick energy changes invalidate coverage permanently for the attempt.
The 0.01 joule per-tick tolerance and one-millionth-item output precision propagate
into an upward-rounded window error bound, rather than silently becoming zero.

Report consumed energy divided by selected fuel value as equivalent fuel items.
Combine it once with any recipe consumption of the same item. Keep remaining energy
as equivalent process stock, so moving an item into a burning buffer does not make
it disappear from boundary accounting. Completed production, started recipe inputs
and measured fuel consumption retain their separate bases. Initial fuel inventory,
burning energy and candidate output cannot preload the interval; save/load still
invalidates active windows and requires fresh evidence.

The native calibration borrows the dedicated probe's world and transport. It moves
only actual declared-source items and manufactured furnace output, checks each
debit/credit, and compares measured fuel against source debits minus remaining
inventory and native remaining energy. It crosses a refill boundary and checks
preload refusal and sticky wrong-fuel invalidation. These diagnostic transfers prove
accounting, not automatic transport, legal construction or S5 physical acceptance.
Ordinary chain launch and library gates remain closed until their later acceptance.
