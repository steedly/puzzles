# Comparison: ll-solver vs John Rausch's Hex Reference Data

*Generated 2026-04-04*

## Methodology

We match John's puzzles to ours by Klein-four-group canonical position form. Our solver deduplicates aggressively by collision signature, keeping one representative per unique collision sequence. Most of John's 127K puzzles were deduped away in our output. Matched puzzles share the same canonical form but may be different dedup survivors with different actual positions (related by symmetry), so move/step counts may differ.

**Definitive verification:** We tested `solve_min_grouped()` directly on all 127,060 of John's exact positions:

| Result | Count |
|--------|------:|
| Equal | 127,056 |
| Ours better | 4 |
| John better | **0** |
| Unsolvable | 0 |

Our solver finds an equal or better solution for **every one** of John's puzzles.

## Summary

| Metric | Value |
|--------|------:|
| Our puzzles | 125,705 |
| John's puzzles | 127,060 |
| Matched (by canonical form) | 26,604 |
| Not found in ours | 100,456 |
| Move count diffs (between dedup survivors) | 2,698 |
| Step count diffs (between dedup survivors) | 9,296 |

> **Note:** "Not found" and "move count diffs" are expected — they reflect different dedup survivors between the two solvers, not bugs. See methodology above.

## Move count discrepancies (sample)

These are between different symmetric representatives, not the same positions. Included for reference.

<details><summary>50 sample discrepancies (of 2,698 total)</summary>

| John's config | Source | John moves | John steps | Our moves | Our slides | Our puzzle |
|---|---|---:|---:|---:|---:|---:|
| X51:21:53:81:44 | hex14/solut001.txt | 5 | 6 | 3 | 5 | #705 |
| X51:11:52:33:63 | hex14/solut001.txt | 2 | 6 | 3 | 8 | #2427 |
| X51:11:52:63:44 | hex14/solut001.txt | 2 | 6 | 4 | 5 | #1257 |
| X51:11:62:53:54 | hex14/solut001.txt | 3 | 4 | 2 | 4 | #2978 |
| X51:61:32:81:73 | hex14/solut001.txt | 2 | 6 | 3 | 6 | #709 |
| X51:61:32:63:91 | hex14/solut001.txt | 2 | 4 | 3 | 5 | #3525 |
| X51:52:43:91:73 | hex14/solut001.txt | 2 | 6 | 3 | 8 | #2563 |
| X51:52:43:91:64 | hex14/solut001.txt | 2 | 6 | 4 | 5 | #1847 |
| X51:42:53:54:91 | hex14/solut001.txt | 3 | 4 | 2 | 4 | #4973 |
| X41:31:11:81:64 | hex14/solut001.txt | 3 | 8 | 2 | 7 | #909 |
| X41:21:11:81:55 | hex14/solut001.txt | 5 | 6 | 3 | 7 | #7284 |
| X41:21:42:81:64 | hex14/solut001.txt | 5 | 5 | 2 | 5 | #8008 |
| X41:11:52:63:44 | hex14/solut001.txt | 2 | 6 | 3 | 6 | #713 |
| X41:11:42:81:55 | hex14/solut001.txt | 5 | 6 | 4 | 5 | #7392 |
| X41:11:71:33:64 | hex14/solut001.txt | 8 | 10 | 2 | 5 | #7862 |
| X41:11:72:63:44 | hex14/solut001.txt | 2 | 4 | 3 | 6 | #7113 |
| X41:61:32:81:64 | hex14/solut001.txt | 5 | 7 | 3 | 6 | #4983 |
| X41:61:22:62:73 | hex14/solut001.txt | 2 | 6 | 6 | 7 | #3401 |
| X41:61:33:91:73 | hex14/solut001.txt | 5 | 9 | 2 | 6 | #4049 |
| X41:42:32:81:64 | hex14/solut001.txt | 5 | 6 | 2 | 5 | #7634 |
| X41:42:22:81:64 | hex14/solut001.txt | 3 | 7 | 2 | 6 | #3780 |
| X41:32:71:44:91 | hex14/solut001.txt | 3 | 6 | 2 | 6 | #7912 |
| X41:22:71:73:55 | hex14/solut001.txt | 4 | 7 | 3 | 7 | #5794 |
| X31:41:33:82:64 | hex14/solut001.txt | 3 | 5 | 2 | 4 | #5672 |
| X31:11:71:44:64 | hex14/solut001.txt | 7 | 10 | 2 | 4 | #6669 |
| X31:61:22:81:55 | hex14/solut001.txt | 4 | 6 | 3 | 4 | #6825 |
| X31:61:33:81:44 | hex14/solut001.txt | 5 | 6 | 2 | 4 | #1465 |
| X31:61:33:81:55 | hex14/solut001.txt | 5 | 7 | 3 | 5 | #2616 |
| X52:11:33:44:73 | hex14/solut001.txt | 3 | 9 | 2 | 5 | #8140 |
| X52:61:42:33:82 | hex14/solut001.txt | 3 | 6 | 5 | 6 | #711 |
| X52:61:33:91:64 | hex14/solut001.txt | 4 | 10 | 2 | 4 | #2952 |
| X52:33:91:82:73 | hex14/solut001.txt | 3 | 8 | 4 | 6 | #4118 |
| X42:51:11:81:55 | hex14/solut001.txt | 6 | 6 | 3 | 5 | #2257 |
| X42:41:11:81:55 | hex14/solut001.txt | 6 | 6 | 3 | 6 | #3083 |
| X42:41:32:82:55 | hex14/solut001.txt | 3 | 5 | 4 | 5 | #1415 |
| X42:52:33:81:55 | hex14/solut001.txt | 2 | 6 | 3 | 5 | #1527 |
| X51:Y21:41:54:82 | hex23/solut001.txt | 6 | 8 | 4 | 6 | #9022 |
| X51:Y21:61:54:91 | hex23/solut001.txt | 8 | 8 | 4 | 7 | #13231 |
| X51:Y21:71:43:63 | hex23/solut001.txt | 3 | 5 | 2 | 6 | #11976 |
| X51:Y21:71:33:63 | hex23/solut001.txt | 3 | 5 | 4 | 9 | #49080 |
| X51:Y21:71:54:91 | hex23/solut001.txt | 7 | 9 | 4 | 7 | #13090 |
| X51:Y21:43:91:64 | hex23/solut001.txt | 8 | 12 | 4 | 6 | #58459 |
| X51:Y21:81:63:54 | hex23/solut001.txt | 5 | 7 | 3 | 5 | #11031 |
| X51:Y21:81:63:44 | hex23/solut001.txt | 5 | 8 | 4 | 7 | #9965 |
| X51:Y21:81:54:73 | hex23/solut001.txt | 5 | 7 | 7 | 7 | #11733 |
| X51:Y21:81:44:64 | hex23/solut001.txt | 6 | 7 | 4 | 5 | #49064 |
| X51:Y11:41:91:64 | hex23/solut001.txt | 7 | 9 | 5 | 8 | #8733 |
| X51:Y11:31:71:54 | hex23/solut001.txt | 7 | 11 | 3 | 7 | #13370 |
| X51:Y11:71:43:64 | hex23/solut001.txt | 8 | 10 | 4 | 8 | #11458 |
| X51:Y11:71:81:54 | hex23/solut001.txt | 6 | 11 | 4 | 7 | #12104 |

</details>

## Puzzles in John's data not found in ours (sample)

These are expected — different dedup survivors. John keeps all configurations; we keep one representative per unique collision signature.

<details><summary>20 sample missing puzzles (of 100,456 total)</summary>

| John's config | Source | Moves | Steps | Positions |
|---|---|---:|---:|---|
| X41:32:82 | hex12/solut001.txt | 1 | 2 | (0,1), (1,3), (4,1) |
| X31:22:82 | hex12/solut001.txt | 2 | 2 | (0,2), (1,4), (4,1) |
| X52:22:72 | hex12/solut001.txt | 1 | 2 | (1,1), (1,4), (3,1) |
| X51:31:32:82 | hex13/solut001.txt | 1 | 3 | (0,0), (0,2), (1,3), (4,1) |
| X51:21:22:82 | hex13/solut001.txt | 2 | 3 | (0,0), (0,3), (1,4), (4,1) |
| X51:21:62:73 | hex13/solut001.txt | 2 | 4 | (0,0), (0,3), (2,1), (4,2) |
| X51:21:33:81 | hex13/solut001.txt | 2 | 4 | (0,0), (0,3), (2,4), (3,0) |
| X51:21:81:73 | hex13/solut001.txt | 2 | 4 | (0,0), (0,3), (3,0), (4,2) |
| X51:21:54:82 | hex13/solut001.txt | 3 | 4 | (0,0), (0,3), (3,3), (4,1) |
| X51:11:62:63 | hex13/solut001.txt | 1 | 3 | (0,0), (0,4), (2,1), (3,2) |
| X51:11:43:91 | hex13/solut001.txt | 3 | 4 | (0,0), (0,4), (2,3), (4,0) |
| X51:42:43:91 | hex13/solut001.txt | 1 | 3 | (0,0), (1,2), (2,3), (4,0) |
| X51:42:33:81 | hex13/solut001.txt | 2 | 4 | (0,0), (1,2), (2,4), (3,0) |
| X51:32:63:91 | hex13/solut001.txt | 1 | 3 | (0,0), (1,3), (3,2), (4,0) |
| X51:32:91:73 | hex13/solut001.txt | 3 | 5 | (0,0), (1,3), (4,0), (4,2) |
| X51:22:71:72 | hex13/solut001.txt | 1 | 3 | (0,0), (1,4), (2,0), (3,1) |
| X41:51:11:82 | hex13/solut001.txt | 3 | 5 | (0,1), (0,0), (0,4), (4,1) |
| X41:21:22:82 | hex13/solut001.txt | 2 | 3 | (0,1), (0,3), (1,4), (4,1) |
| X41:21:81:73 | hex13/solut001.txt | 2 | 4 | (0,1), (0,3), (3,0), (4,2) |
| X41:21:54:82 | hex13/solut001.txt | 2 | 3 | (0,1), (0,3), (3,3), (4,1) |

</details>
