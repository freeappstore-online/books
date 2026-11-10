"""Build the catalogue's book texts from Project Gutenberg (books#5).

usage: fetch.py CACHE_DIR [SLUG...]
Downloads each book's plain text into CACHE_DIR (once, ~1 req/s), keeps only the text between
the `*** START/END OF` markers, drops front and back matter, splits on the book's own headings
and writes web/public/catalog/<slug>.json = {"chapters": [{"title", "content"}]}. Then updates
`chapters` and `readTime` in web/src/data/catalog.ts from the files. No caps: whole books.

Content is what the reader shows and TTS reads verbatim, so headings, licence text, tables of
contents and markup never reach it. Paragraphs are separated by a blank line; prose is unwrapped,
verse keeps its line breaks.
"""
import json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "web/public/catalog")
CATALOG_TS = os.path.join(ROOT, "web/src/data/catalog.ts")
USER_AGENT = "freeappstore-books/1.0 (+https://github.com/freeappstore-online/books)"
WORDS_PER_MIN = 250

# Not on Project Gutenberg (yet): their current files are kept as they are.
UNSOURCED = {"as-i-lay-dying", "red-harvest", "to-the-lighthouse"}

# slug -> (Gutenberg id, or a tuple of volumes: id or (id, volume options), options). Options:
#   heads: extra heading regex(es) (full stripped line), tried before the generic ones; groups kind,
#          num, rest make the title, a `fold` group marks a sub-heading folded into its chapter
#   heads_only: no generic headings (CHAPTER I, BOOK II, bare numerals...)
#   toc:   also take headings from the book's own contents list
#   start: regex of the line where the text begins (its first match, or match start_n)
#   end:   regex of the line where the text ends, excluded (its last match, or match end_n)
#   drop:  regex of headings whose sections are left out (editorial notes, indexes...)
#   first: title of the text before the first heading (when that heading is lost in markup)
#   sub:   take a title-case line after a bare heading as its subtitle
#   nosub: never take the line after a heading as its subtitle
#   label: what a bare numeral heading is called ("Chapter" by default)
#   titles: {regex: replacement} applied to the final chapter titles
#   level: heading level that makes a chapter (0 book/part/act, 1 chapter/scene, 2 bare numeral)
#   keep:  regex of a heading that looks like back matter but is the author's (an appendix)
#   cut:   [(start regex, end regex)]: remove every run of lines from a start line to the next end line
#   gloss: remove Purves' marginal glosses and note references (Chaucer)
#   strip: regex of whole lines to remove (running heads, part dividers...)
# A text with no headings at all is split at paragraph boundaries into ~20k-char parts.
BOOKS = {
    "alice-in-wonderland": (11, {}),
    "pride-and-prejudice": (1342, {"start": r"It is a truth universally.*", "first": "Chapter 1", "end": r"CHISWICK PRESS.*"}),
    "the-art-of-war": (17405, {}),
    "meditations": (2680, {"start": r"THE FIRST BOOK", "end": r"APPENDIX", "heads": r"THE (?P<num>[A-Z]+) BOOK", "heads_only": True, "label": "Book"}),
    "the-great-gatsby": (64317, {}),
    "romeo-and-juliet": (1513, {}),
    "frankenstein": (84, {}),
    "the-picture-of-dorian-gray": (174, {}),
    "dracula": (345, {}),
    "sherlock-holmes": (1661, {"heads": r"[IVX]+\. (?P<rest>(?:A|THE) [A-Z].*)"}),
    "metamorphosis": (5200, {}),
    "the-prince": (1232, {"start": r"DEDICATION", "start_n": 1, "first": "Dedication", "heads": r"(?P<rest>THE PRINCE)", "end": r"DESCRIPTION OF THE METHODS ADOPTED BY THE DUKE VALENTINO WHEN MURDERING"}),
    "a-tale-of-two-cities": (98, {}),
    "moby-dick": (2701, {"start": r"ETYMOLOGY\.", "start_n": 1, "heads": r"(?P<rest>ETYMOLOGY|EXTRACTS)\.?"}),
    "jane-eyre": (1260, {}),
    "wuthering-heights": (768, {}),
    "crime-and-punishment": (2554, {}),
    "treasure-island": (120, {"titles": {r"Chapter 27: Narrative Continued": "Chapter 17: Narrative Continued"}}),
    "jekyll-and-hyde": (43, {"toc": True}),
    "war-of-the-worlds": (36, {}),
    "the-time-machine": (35, {}),
    "a-christmas-carol": (46, {}),
    "heart-of-darkness": (219, {}),
    "the-call-of-the-wild": (215, {}),
    "walden": (205, {"toc": True}),
    "the-odyssey": (1727, {"start": r"BOOK I"}),
    "the-iliad": (2199, {}),
    "don-quixote": ((
        (996, {"end": r"DEDICATION OF VOLUME II\.", "titles": {r"^Chapter": "Part 1, Chapter"}}),
        (996, {"start": r"DEDICATION OF VOLUME II\.",
               "titles": {r"^Chapter": "Part 2, Chapter", r"^The Author’s Preface$": "The Author’s Preface to Part 2"}}),
    ), {"drop": r"Introduction.*", "heads": r"(?P<rest>THE AUTHOR’S PREFACE|SOME COMMENDATORY VERSES|DEDICATION OF (?:PART I|VOLUME II))\.?"}),
    "les-miserables": (135, {}),
    "the-count-of-monte-cristo": (1184, {}),
    "the-jungle-book": (236, {"toc": True}),
    "the-republic": (1497, {"start": r"BOOK I\.", "start_n": 1}),
    "a-study-in-scarlet": (244, {}),
    "the-hound-of-the-baskervilles": (2852, {}),
    "the-invisible-man": (5230, {}),
    "around-the-world-in-80-days": (103, {}),
    "twenty-thousand-leagues": (2488, {"sub": True, "drop": r"Introduction.*", "end": r"END OF THE SECOND PART"}),
    "great-expectations": (1400, {}),
    "david-copperfield": (766, {}),
    "the-adventures-of-tom-sawyer": (74, {}),
    "adventures-of-huckleberry-finn": (76, {"start": r"CHAPTER I\.", "start_n": 1}),
    "little-women": (514, {}),
    "sense-and-sensibility": (161, {}),
    "emma": (158, {}),
    "the-scarlet-letter": (33, {"heads": r"(?P<rest>THE CUSTOM-HOUSE|THE SCARLET LETTER)", "level": 2}),
    "thus-spoke-zarathustra": (1998, {"start": r"FIRST PART\. ZARATHUSTRA’S DISCOURSES\.", "end": r"APPENDIX\.?", "heads": [r"(?P<rest>ZARATHUSTRA’S PROLOGUE)\.", r"(?P<num>[LXVI]+)\. (?P<rest>[A-Z][^a-z]+)"], "strip": r"THUS SPAKE ZARATHUSTRA\. \w+ PART\.|(?:SECOND|THIRD|FOURTH AND LAST) PART\.|ZARATHUSTRA’S DISCOURSES\."}),
    "anna-karenina": (1399, {}),
    "the-secret-garden": (113, {}),
    "the-brothers-karamazov": (28054, {}),
    "bleak-house": (1023, {}),
    "northanger-abbey": (121, {"end": r"A NOTE ON THE TEXT"}),
    "persuasion": (105, {}),
    "mansfield-park": (141, {}),
    "a-room-with-a-view": (2641, {}),
    "the-age-of-innocence": (541, {"end": r"A Note on the Text"}),
    "uncle-toms-cabin": (203, {}),
    "the-scarlet-pimpernel": (60, {}),
    "oliver-twist": (730, {}),
    "gulliver-travels": (829, {}),
    "the-phantom-of-the-opera": (175, {}),
    "peter-pan": (16, {}),
    "the-wonderful-wizard-of-oz": (55, {}),
    "the-three-musketeers": (1257, {}),
    "the-importance-of-being-earnest": (844, {}),
    "middlemarch": (145, {"start": r"PRELUDE\.", "start_n": 1}),
    "tess-of-the-durbervilles": (110, {}),
    "robinson-crusoe": (521, {}),
    "ivanhoe": (82, {"end": r"NOTE TO CHAPTER I\.", "end_n": 1}),
    "anne-of-green-gables": (45, {}),
    "ethan-frome": (4517, {"start": r"I had the story, bit by bit, from various people, and, as generally", "first": "Prologue"}),
    "the-awakening": (160, {"end": r"BEYOND THE BAYOU", "end_n": 1}),
    "dead-souls": (1081, {"drop": r"Introduction.*"}),
    "sons-and-lovers": (217, {}),
    "the-man-who-was-thursday": (1695, {}),
    "silas-marner": (550, {}),
    "candide": (19942, {"start": r"CANDIDE", "start_n": 1, "end": r"\+-{10,}\+", "end_n": -2}),
    "a-portrait-of-the-artist": (4217, {}),
    "the-turn-of-the-screw": (209, {"heads": r"(?P<rest>THE TURN OF THE SCREW)", "titles": {r"^The Turn of the Screw$": "Prologue"}}),
    "notes-from-underground": (600, {}),
    "the-jungle": (140, {}),
    "hamlet": (1524, {}),
    "a-midsummer-nights-dream": (1514, {}),
    "a-dolls-house": (2542, {}),
    "pygmalion": (3825, {}),
    "narrative-of-frederick-douglass": (23, {"keep": r"APPENDIX", "heads": r"(?P<rest>APPENDIX|LETTER FROM WENDELL PHILLIPS, ESQ\.)"}),
    "leviathan": (3207, {"start": r"THE INTRODUCTION"}),
    "the-enchanted-april": (16389, {}),
    "the-blue-castle": (67979, {}),
    "the-king-in-yellow": (8492, {"toc": True, "heads": r"(?P<rest>IN THE COURT OF THE DRAGON)"}),
    "twenty-years-after": (1259, {}),
    "a-connecticut-yankee": (86, {"heads": r"(?P<rest>A WORD OF EXPLANATION|THE STRANGER.S HISTORY)", "strip": r"MARK TWAIN|A CONNECTICUT YANKEE IN KING ARTHUR.S COURT|THE TALE OF THE LOST LAND"}),
    "cranford": (394, {"end": r"PRINTED BY"}),
    "jude-the-obscure": (153, {"start": r"PREFACE", "start_n": 1, "heads": r"(?P<kind>Part) (?P<num>First|Second|Third|Fourth|Fifth|Sixth)\s+(?P<rest>.*)"}),
    "twelfth-night": (1526, {}),
    "leaves-of-grass": (1322, {"heads": r"(?P<kind>BOOK) ?(?P<num>[IVXL]+)\.?(?:\s+(?P<rest>.*))?", "heads_only": True}),
    "mrs-dalloway": (71865, {"start": r"Mrs\. Dalloway said she would buy the flowers.*"}),
    "the-sun-also-rises": (67138, {}),
    "a-farewell-to-arms": (75201, {}),
    "the-sound-and-the-fury": (75170, {"heads": r"(?P<rest>(?:APRIL|JUNE) [A-Z]+, 19\d\d)\.?"}),
    "manhattan-transfer": (71853, {"heads": r"(?P<num>First|Second|Third) (?P<kind>Section)"}),
    "lady-chatterleys-lover": (73144, {}),
    "the-maltese-falcon": (77600, {"heads": r"(?P<num>\d{1,2})"}),
    "bambi": (72577, {}),
    "cane": (60093, {"toc": True}),
    "north-of-boston": (3026, {"toc": True}),
    "the-red-house-mystery": (1872, {}),
    "autobiography-of-benjamin-franklin": (148, {"start": r"Twyford, at the Bishop of St\. Asaph.s,.*", "end": r"CHIEF EVENTS IN FRANKLIN.S LIFE\.?"}),
    "far-from-the-madding-crowd": (107, {}),
    "grimms-fairy-tales": (2591, {"toc": True, "end": r"\*{5}"}),
    "the-merchant-of-venice": (1515, {}),
    "the-prince-and-the-pauper": (1837, {"end": r"FOOTNOTES AND TWAIN’S NOTES"}),
    "the-wind-in-the-willows": (289, {}),
    "ulysses": (4300, {"heads": r"\[ (?P<num>\d+) \]", "heads_only": True, "label": "Episode", "strip": r"— [IVX]+ —", "nosub": True}),
    "all-quiet-on-the-western-front": (75011, {"end": r"CHISWICK PRESS.*"}),
    "the-canterbury-tales": (2383, {"start": r"THE PROLOGUE\.", "first": "The General Prologue", "end": r"THE END OF THE CANTERBURY TALES", "gloss": True, "cut": [(r"Notes to .*", r"(?:THE|CHAUCER’S) [A-ZŒ’ ]*TALE.*|\*?PRECES DE CHAUCERES.*")], "heads": r"(?P<fold>THE (?:PROLOGUE|TALE))\.? *|(?P<rest>(?:THE|CHAUCER’S) [A-ZŒ’ ]*TALE(?: OF [A-ZŒ ]+)?|PRECES DE CHAUCERES)\.? *", "heads_only": True}),
    "aesops-fables": (21, {"start": r"The Lion And The Mouse", "start_n": 1, "end": r"FOOTNOTES"}),
    "short-fiction-poe": ((2147, 2148, 2150), {"toc": True, "heads": r"(?P<rest>THE UNPARALLELED ADVENTURES OF ONE HANS PFAAL) ?", "drop": r"Preface|Life of Poe|Death of Poe|Death of Edgar A\. Poe"}),
    "poetry-poe": (10031, {"start": r"POEMS OF LATER LIFE", "end": r"ESSAYS\.", "cut": [(r"NOTES\.", r"POEMS OF MANHOOD\.|SCENES FROM \"POLITIAN\.\"|POEMS OF YOUTH|DOUBTFUL POEMS\.|PROSE POEMS\.")], "heads": r"(?P<fold>(?:PART )?[IVX]+\.?)|(?P<rest>[A-Z][A-Z0-9 ,\x27\"’()—.!?;:-]{2,})", "heads_only": True, "drop": r"Note on Politian", "titles": {r"^An Unpublished Drama.*": "Scenes from Politian", r"^Letter to Mr\. B.*": "Letter to Mr. B——", r"[,.]$": ""}}),
    "hemingway-short-fiction": ((
        (59603, {"start": r"UP IN MICHIGAN", "start_n": 1, "end": r"MITRAIGLIATRICE",  # the stories, not the poems
                 "heads": r"(?P<rest>UP IN MICHIGAN|OUT OF SEASON|MY OLD MAN)", "heads_only": True}),
        (61085, {"heads": r"chapter (?P<num>\d+)", "titles": {r"^Chapter": "In Our Time, Chapter"}}),
        (69683, {"toc": True}),
    ), {}),
    "a-passage-to-india": (61221, {"end": r"Weybridge, 1924\."}),
    "howards-end": (2891, {}),
    "winesburg-ohio": (416, {"start": r"THE BOOK OF THE GROTESQUE", "start_n": 1, "heads": r"(?P<rest>[A-Z“\"][A-Z “”\"’,.-]{2,})", "heads_only": True, "titles": {r"^Part (One|Two|Three|Four)$": r"Godliness, Part \1"}}),
    "my-antonia": (242, {}),
    "the-house-of-mirth": (284, {}),
    "the-secret-agent": (974, {}),
    "lord-jim": (5658, {}),
    "sister-carrie": (233, {}),
    "main-street": (543, {}),
    "babbitt": (1156, {}),
    "madame-bovary": (2413, {}),
    "the-idiot": (2638, {}),
    "germinal": (56528, {}),
    "north-and-south": (4276, {}),
    "villette": (9182, {}),
    "shirley": (30486, {}),
    "the-mayor-of-casterbridge": (143, {}),
    "the-woodlanders": (482, {}),
    "the-return-of-the-native": (122, {}),
    "lorna-doone": (840, {}),
    "the-portrait-of-a-lady": ((2833, 2834), {}),
    "the-ambassadors": (432, {}),
    "washington-square": (2870, {}),
    "the-house-of-the-seven-gables": (77, {}),
    "jacobs-room": (5670, {}),
    "the-voyage-out": (144, {}),
    "night-and-day": (1245, {}),
    "arrowsmith": (70875, {}),
    "martin-eden": (1056, {}),
    "the-old-curiosity-shop": (700, {}),
    "the-mystery-of-edwin-drood": (564, {}),
    "kidnapped": (421, {}),
    "king-solomons-mines": (2166, {}),
    "she": (3155, {}),
    "the-prisoner-of-zenda": (95, {}),
    "scaramouche": (1947, {}),
    "captain-blood": (1965, {}),
    "the-last-of-the-mohicans": (940, {}),
    "the-sea-wolf": (1074, {}),
    "white-fang": (910, {}),
    "a-princess-of-mars": (62, {}),
    "the-thirty-nine-steps": (558, {}),
    "the-mysterious-island": (1268, {}),
    "the-lost-world": (139, {}),
    "the-island-of-doctor-moreau": (159, {}),
    "the-red-badge-of-courage": (73, {}),
    "three-men-in-a-boat": (308, {}),
    "the-sign-of-the-four": (2097, {}),
    "the-valley-of-fear": (3289, {}),
    "the-memoirs-of-sherlock-holmes": (834, {}),
    "the-mystery-of-the-yellow-room": (1685, {}),
    "arsene-lupin-gentleman-burglar": (6133, {}),
    "lady-audleys-secret": (8954, {}),
    "anne-of-avonlea": (47, {}),
    "the-railway-children": (1874, {}),
    "pinocchio": (500, {}),
    "macbeth": (1533, {}),
    "as-you-like-it": (1523, {}),
    "up-from-slavery": (2376, {}),
    "incidents-in-the-life-of-a-slave-girl": (11030, {}),
    "the-problems-of-philosophy": (5827, {}),
    "second-treatise-of-government": (7370, {}),
    "confessions-of-st-augustine": (3296, {}),
    "beyond-good-and-evil": (4363, {}),
    "evelina": (6053, {}),
    "nicholas-nickleby": (967, {}),
    "our-mutual-friend": (883, {}),
    "barnaby-rudge": (917, {}),
    "dombey-and-son": (821, {}),
    "the-trial": (7849, {}),
    "heidi": (1448, {}),
    "notre-dame-de-paris": (2610, {}),
    "demons": (8117, {}),
    "the-rainbow": (28948, {}),
    "women-in-love": (4240, {}),
    "this-side-of-paradise": (805, {}),
    "the-beautiful-and-damned": (9830, {}),
    "the-mysteries-of-udolpho": (3268, {}),
    "the-monk": (601, {}),
    "kim": (2226, {}),
    "from-the-earth-to-the-moon": (83, {}),
    "war-and-peace": (2600, {"heads": r"(?P<rest>(?:FIRST|SECOND) EPILOGUE(?:: .*)?)"}),
    "waverley": (5998, {"start": r"Volume I\.", "end": r"NOTES—Volume I\."}),
    "the-great-god-pan": (389, {"start": r"I"}),
    "the-castle-of-otranto": (696, {"start": r"PREFACE TO THE FIRST EDITION\."}),
    "the-innocents-abroad": (3176, {"start": r"PREFACE"}),
    "life-on-the-mississippi": (245, {"start": r"THE \x27BODY OF THE NATION\x27", "heads": r"(?P<rest>THE \x27BODY OF THE NATION\x27)", "sub": True, "end": r"APPENDIX"}),
    "fathers-and-sons": (47935, {"drop": r"Introduction", "end": r"End of Project Gutenberg.*"}),
    "captains-courageous": (2186, {"end": r"End of Project Gutenberg.*"}),
    "rob-roy": (7025, {"start": r"VOLUME ONE", "end": r"POSTSCRIPT\."}),
    "a-little-princess": (146, {"start": r"1", "heads": r"(?P<num>\d{1,2})", "sub": True, "end": r"End of Project Gutenberg.*"}),
    "agnes-grey": (767, {"end": r"_?Spottiswode.*"}),
    "tarzan-of-the-apes": (78, {"end": r"FOR THE"}),
    "carmilla": (10007, {"end": r"Other books by J\. Sheridan LeFanu"}),
    "the-case-book-of-sherlock-holmes": (69700, {"end": r"Printed in Great Britain.*"}),
    "black-beauty": (271, {"start": r"Part I", "start_n": 1, "heads": r"(?P<num>\d\d) (?P<rest>[A-Z].*)"}),
    "the-moonstone": (155, {"start": r"PROLOGUE", "start_n": 1, "heads": r"(?P<rest>FIRST PERIOD|(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH) NARRATIVE)\.?", "strip": r"THE STORY|THE END OF THE FIRST PERIOD\.|SECOND PERIOD\.|THE DISCOVERY OF THE TRUTH\. \(1848-1849\.\)|The Events related in several Narratives\."}),
    "the-master-of-ballantrae": (864, {"end": r"Footnotes\.", "titles": {r"SUMMARY OF EVENTS \(continued\)": "Summary of Events (continued)", r"THE JOURNEY IN THE WILDERNESS \(continued\)": "The Journey in the Wilderness (continued)"}}),
    "on-the-origin-of-species": (1228, {"start": r"INTRODUCTION\.", "start_n": 2, "end": r"INDEX\.", "titles": {r"GEOGRAPHICAL DISTRIBUTION—continued": "Geographical Distribution (continued)"}}),
    "the-tenant-of-wildfell-hall": (969, {"start": r"AUTHOR’S PREFACE\[2\]", "heads": r"(?P<rest>AUTHOR’S PREFACE)", "titles": {r"^Author’s Preface$": "Author’s Preface to the Second Edition"}}),
    "the-red-and-the-black": (44747, {"drop": r"Introduction"}),
    "father-goriot": (1237, {"start": r"FATHER GORIOT", "start_n": 1, "first": "Father Goriot", "end": r"ADDENDUM"}),
    "dubliners": (2814, {"toc": True, "start": r"THE SISTERS"}),
    "the-innocence-of-father-brown": (204, {"toc": True}),
    "the-wisdom-of-father-brown": (223, {"heads": r"[A-Z]+\.? -- (?P<rest>.+)", "heads_only": True, "start": r"ONE -- .*"}),
    "the-return-of-sherlock-holmes": (108, {"start": r"THE ADVENTURE OF THE EMPTY HOUSE", "heads": r"(?P<rest>THE ADVENTURE OF [A-Z’ -]+)", "heads_only": True}),
    "his-last-bow": (2350, {"toc": True, "heads": r"(?P<fold>\d\. .*|PART II?)", "strip": r"The Singular Experience of Mr\. John Scott Eccles|The Tiger of San Pedro"}),
    "the-divine-comedy": (1004, {"start": r"Inferno: Canto I", "heads": r"(?P<rest>(?:Inferno|Purgatorio|Paradiso): Canto [IVXL]+)", "heads_only": True, "strip": r"PURGATORIO|PARADISO"}),
    "utopia": (2130, {"toc": True, "start": r"DISCOURSES OF RAPHAEL HYTHLODAY.*", "start_n": 1}),
    "symposium": (1600, {"start": r"SYMPOSIUM", "start_n": 1, "first": "Symposium"}),
    "apology": (1656, {"start": r"APOLOGY", "start_n": 1, "first": "Apology"}),
    "common-sense": (147, {"start": r"INTRODUCTION\.", "end": r"F  I  N  I  S\.", "keep": r"APPENDIX\.", "heads": r"(?P<rest>INTRODUCTION|OF THE ORIGIN AND DESIGN OF GOVERNMENT IN GENERAL|OF MONARCHY AND HEREDITARY SUCCESSION|THOUGHTS ON THE PRESENT STATE OF AMERICAN AFFAIRS|OF THE PRESENT ABILITY OF AMERICA|APPENDIX)[.,]", "heads_only": True, "titles": {r"^Of the Origin and Design of Government in General$": "Of the Origin and Design of Government in General, with Concise Remarks on the English Constitution", r"^Of the Present Ability of America$": "Of the Present Ability of America, with Some Miscellaneous Reflexions"}}),
    "civil-disobedience": (71, {"start": r"I heartily accept the motto.*", "first": "Civil Disobedience"}),
    "the-call-of-cthulhu": (68283, {"start": r"\"Of such great powers.*", "first": "Chapter 1: The Horror in Clay", "heads": r"(?P<fold>1\. The Horror in Clay\.)|(?P<num>[23])\. (?P<rest>.+)\.", "heads_only": True}),
    "the-yellow-wallpaper": (1952, {"start": r"It is very seldom that mere ordinary people.*", "first": "The Yellow Wallpaper"}),
    "at-the-mountains-of-madness": (70652, {"start": r"I am forced into speech because.*", "first": "Chapter 1"}),
    "the-legend-of-sleepy-hollow": (41, {"start": r"A pleasing land of drowsy head it was,", "first": "The Legend of Sleepy Hollow"}),
    "through-the-looking-glass": (12, {"titles": {r"^Chapter 10: Shaking$": "Chapters 10 and 11: Shaking and Waking"}}),
    "the-analects": (3330, {"start": r"BOOK I\.  HSIO R\."}),
    "spoon-river-anthology": (1280, {"start": r"The Hill", "heads": r"(?!Hod Putt$)(?=.*[a-z])(?P<rest>(?:[A-Z“\"][\w’\x27”\".-]*|of|the|and)(?: (?:[A-Z“\"][\w’\x27”\".-]*|of|the|and)){0,5})", "heads_only": True, "titles": {r"^The Hill$": "The Hill; Hod Putt"}}),
    "songs-of-innocence-and-experience": (1934, {"start": r"SONGS OF INNOCENCE", "start_n": 2, "heads": r"(?P<rest>SONGS OF (?:INNOCENCE|EXPERIENCE))", "heads_only": True, "titles": {r": Introduction$": ""}}),
    "the-aeneid": (228, {"titles": {r": The Argument$": ""}}),
    "the-sorrows-of-young-werther": (2527, {"drop": r"(?!)", "heads": r"(?P<rest>(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) \d+(?:, \d{4})?|THE SAME EVENING|THE EDITOR TO THE READER)\.?"}),
    "paradise-lost": (26, {"start": r"Book I"}),
    "faust": (14591, {"start": r"Again ye come, ye hovering Forms! I find ye,", "first": "Dedication and Prelude at the Theatre", "heads": [r"(?P<num>[IVXL]+)", r"(?P<rest>PROLOGUE IN HEAVEN)"], "heads_only": True, "label": "Scene", "strip": r"FIRST PART OF THE TRAGEDY|\[illustration\]", "titles": {r"^(Scene 8: Evening) a Small, Neatly Kept Chamber$": r"\1", r"^(Scene 5: Auerbach’s Cellar in Leipzig) Carousal of Jolly Companions$": r"\1"}}),
    "hedda-gabler": (4093, {"start": r"ACT FIRST\."}),
    "doctor-faustus": (779, {"start": r"THE TRAGICAL HISTORY OF DOCTOR FAUSTUS", "start_n": 1, "first": "Doctor Faustus", "strip": r"FROM THE QUARTO OF 1604\."}),
    "on-liberty": (34901, {"start": r"ON LIBERTY\.", "cut": [(r"FOOTNOTES?:", r"CHAPTER [IVX]+\.")]}),
    "the-enchiridion": (45109, {"start": r"THE ENCHIRIDION", "start_n": -1, "end": r"Footnotes", "titles": {r"^Chapter 7$": "Chapters 7–9", r"^Chapter 20$": "Chapters 20–21", r"^Chapter 22$": "Chapters 22–23", r"^Chapter 26$": "Chapters 26–28", r"^Chapter 34$": "Chapters 34–35", r"^Chapter 36$": "Chapters 36–38", r"^Chapter 40$": "Chapters 40–41", r"^Chapter 49$": "Chapters 49–50"}}),
    "the-communist-manifesto": (61, {"start": r"A spectre is haunting Europe.*", "first": "Preamble"}),
    "just-so-stories": (2781, {"toc": True, "start": r"HOW THE WHALE GOT HIS THROAT", "start_n": 1}),
    "hard-times": (786, {"start": r"BOOK THE FIRST"}),
    "o-pioneers": (24, {"start": r"PRAIRIE SPRING", "heads": r"(?P<rest>PRAIRIE SPRING)"}),
    "little-dorrit": (963, {"heads": r"(?P<kind>CHAPTER) (?P<num>23)\. (?P<rest>Mistress Affery makes a Conditional Promise),", "titles": {r"Mistress Affery makes a Conditional Promise$": "Mistress Affery makes a Conditional Promise, respecting her Dreams"}}),
    "martin-chuzzlewit": (968, {"heads": r"(?P<fold>CONCLUSION OF THE ENTERPRISE OF MR JONAS AND HIS FRIEND)", "titles": {r"^Chapter 47$": "Chapter 47: Conclusion of the Enterprise of Mr Jonas and His Friend"}}),
    "the-pickwick-papers": (580, {"start": r"CHAPTER I\. THE PICKWICKIANS", "heads": r"(?P<kind>CHAPTER) (?P<num>[IVXL]+)\. (?P<rest>.*)", "strip": r"KILLING THE CROW, SHOT AT THE CROW AND WOUNDED THE PIGEON; HOW THE|DINGLEY DELL CRICKET CLUB PLAYED ALL\-MUGGLETON, AND HOW ALL\-MUGGLETON|DINED AT THE DINGLEY DELL EXPENSE; WITH OTHER INTERESTING AND|INSTRUCTIVE MATTERS|DISTINGUISHED PERSONS; AND AN ACCURATE DESCRIPTION OF A PUBLIC BREAKFAST|IN THEIR HOUSE AND GROUNDS: WHICH PUBLIC BREAKFAST LEADS TO THE|RECOGNITION OF AN OLD ACQUAINTANCE, AND THE COMMENCEMENT OF ANOTHER|CHAPTER|CLERKS MEN OF PLEASURE; AND HOW AN AFFECTING INTERVIEW TOOK PLACE|BETWEEN MR\. WELLER AND HIS LONG\-LOST PARENT; SHOWING ALSO WHAT CHOICE|SPIRITS ASSEMBLED AT THE MAGPIE AND STUMP, AND WHAT A CAPITAL CHAPTER|THE NEXT ONE WILL BE|OF A WEDDING, AND SOME OTHER SPORTS BESIDE: WHICH ALTHOUGH IN THEIR WAY,|EVEN AS GOOD CUSTOMS AS MARRIAGE ITSELF, ARE NOT QUITE SO RELIGIOUSLY|KEPT UP, IN THESE DEGENERATE TIMES", "titles": {r"^Chapter 2:.*": "Chapter 2: The First Day’s Journey, and the First Evening’s Adventures; with Their Consequences", r"^Chapter 3:.*": "Chapter 3: A New Acquaintance--The Stroller’s Tale--A Disagreeable Interruption, and an Unpleasant Encounter", r"^Chapter 4:.*": "Chapter 4: A Field Day and Bivouac--More New Friends--An Invitation to the Country", r"^Chapter 5:.*": "Chapter 5: A Short One--Showing, Among Other Matters, How Mr. Pickwick Undertook to Drive, and Mr. Winkle to Ride, and How They Both Did It", r"^Chapter 6:.*": "Chapter 6: An Old-Fashioned Card-Party--The Clergyman’s Verses--The Story of the Convict’s Return", r"^Chapter 7:.*": "Chapter 7: How Mr. Winkle, Instead of Shooting at the Pigeon and Killing the Crow, Shot at the Crow and Wounded the Pigeon; How the Dingley Dell Cricket Club Played All-Muggleton, and How All-Muggleton Dined at the Dingley Dell Expense; with Other Interesting and Instructive Matters", r"^Chapter 8:.*": "Chapter 8: Strongly Illustrative of the Position, That the Course of True Love Is Not a Railway", r"^Chapter 10:.*": "Chapter 10: Clearing Up All Doubts (If Any Existed) of the Disinterestedness of Mr. A. Jingle’s Character", r"^Chapter 11:.*": "Chapter 11: Involving Another Journey, and an Antiquarian Discovery; Recording Mr. Pickwick’s Determination to Be Present at an Election; and Containing a Manuscript of the Old Clergyman’s", r"^Chapter 12:.*": "Chapter 12: Descriptive of a Very Important Proceeding on the Part of Mr. Pickwick; No Less an Epoch in His Life, Than in This History", r"^Chapter 13:.*": "Chapter 13: Some Account of Eatanswill; of the State of Parties Therein; and of the Election of a Member to Serve in Parliament for That Ancient, Loyal, and Patriotic Borough", r"^Chapter 14:.*": "Chapter 14: Comprising a Brief Description of the Company at the Peacock Assembled; and a Tale Told by a Bagman", r"^Chapter 15:.*": "Chapter 15: In Which Is Given a Faithful Portraiture of Two Distinguished Persons; and an Accurate Description of a Public Breakfast in Their House and Grounds: Which Public Breakfast Leads to the Recognition of an Old Acquaintance, and the Commencement of Another Chapter", r"^Chapter 17:.*": "Chapter 17: Showing That an Attack of Rheumatism, in Some Cases, Acts as a Quickener to Inventive Genius", r"^Chapter 18:.*": "Chapter 18: Briefly Illustrative of Two Points; First, the Power of Hysterics, And, Secondly, the Force of Circumstances", r"^Chapter 20:.*": "Chapter 20: Showing How Dodson and Fogg Were Men of Business, and Their Clerks Men of Pleasure; and How an Affecting Interview Took Place Between Mr. Weller and His Long-Lost Parent; Showing Also What Choice Spirits Assembled at the Magpie and Stump, and What a Capital Chapter the Next One Will Be", r"^Chapter 21:.*": "Chapter 21: In Which the Old Man Launches Forth into His Favourite Theme, and Relates a Story About a Queer Client", r"^Chapter 22:.*": "Chapter 22: Mr. Pickwick Journeys to Ipswich and Meets with a Romantic Adventure with a Middle-Aged Lady in Yellow Curl-Papers", r"^Chapter 23:.*": "Chapter 23: In Which Mr. Samuel Weller Begins to Devote His Energies to the Return Match Between Himself and Mr. Trotter", r"^Chapter 24:.*": "Chapter 24: Wherein Mr. Peter Magnus Grows Jealous, and the Middle- Aged Lady Apprehensive, Which Brings the Pickwickians Within the Grasp of the Law", r"^Chapter 25:.*": "Chapter 25: Showing, Among a Variety of Pleasant Matters, How Majestic and Impartial Mr. Nupkins Was; and How Mr. Weller Returned Mr. Job Trotter’s Shuttlecock as Heavily as It Came--With Another Matter, Which Will Be Found in Its Place", r"^Chapter 26:.*": "Chapter 26: Which Contains a Brief Account of the Progress of the Action of Bardell Against Pickwick", r"^Chapter 27:.*": "Chapter 27: Samuel Weller Makes a Pilgrimage to Dorking, and Beholds His Mother-In-Law", r"^Chapter 28:.*": "Chapter 28: A Good-Humoured Christmas Chapter, Containing an Account of a Wedding, and Some Other Sports Beside: Which Although in Their Way, Even as Good Customs as Marriage Itself, Are Not Quite So Religiously Kept Up, in These Degenerate Times", r"^Chapter 30:.*": "Chapter 30: How the Pickwickians Made and Cultivated the Acquaintance of a Couple of Nice Young Men Belonging to One of the Liberal Professions; How They Disported Themselves on the Ice; and How Their Visit Came to a Conclusion", r"^Chapter 31:.*": "Chapter 31: Which Is All About the Law, and Sundry Great Authorities Learned Therein", r"^Chapter 32:.*": "Chapter 32: Describes, Far More Fully Than the Court Newsman Ever Did, a Bachelor’s Party, Given by Mr. Bob Sawyer at His Lodgings in the Borough", r"^Chapter 33:.*": "Chapter 33: Mr. Weller the Elder Delivers Some Critical Sentiments Respecting Literary Composition; And, Assisted by His Son Samuel, Pays a Small Instalment of Retaliation to the Account of the Reverend Gentleman with the Red Nose", r"^Chapter 34:.*": "Chapter 34: Is Wholly Devoted to a Full and Faithful Report of the Memorable Trial of Bardell Against Pickwick", r"^Chapter 35:.*": "Chapter 35: In Which Mr. Pickwick Thinks He Had Better Go to Bath; and Goes Accordingly", r"^Chapter 36:.*": "Chapter 36: The Chief Features of Which Will Be Found to Be an Authentic Version of the Legend of Prince Bladud, and a Most Extraordinary Calamity That Befell Mr. Winkle", r"^Chapter 37:.*": "Chapter 37: Honourably Accounts for Mr. Weller’s Absence, by Describing a Soiree to Which He Was Invited and Went; Also Relates How He Was Entrusted by Mr. Pickwick with a Private Mission of Delicacy and Importance", r"^Chapter 38:.*": "Chapter 38: How Mr. Winkle, When He Stepped Out of the Frying-Pan, Walked Gently and Comfortably into the Fire", r"^Chapter 39:.*": "Chapter 39: Mr. Samuel Weller, Being Intrusted with a Mission of Love, Proceeds to Execute It; with What Success Will Hereinafter Appear", r"^Chapter 40:.*": "Chapter 40: Introduces Mr. Pickwick to a New and Not Uninteresting Scene in the Great Drama of Life", r"^Chapter 41:.*": "Chapter 41: What Befell Mr. Pickwick When He Got into the Fleet; What Prisoners He Saw There, and How He Passed the Night", r"^Chapter 42:.*": "Chapter 42: Illustrative, Like the Preceding One, of the Old Proverb, That Adversity Brings a Man Acquainted with Strange Bedfellows-- Likewise Containing Mr. Pickwick’s Extraordinary and Startling Announcement to Mr. Samuel Weller", r"^Chapter 44:.*": "Chapter 44: Treats of Divers Little Matters Which Occurred in the Fleet, and of Mr. Winkle’s Mysterious Behaviour; and Shows How the Poor Chancery Prisoner Obtained His Release at Last", r"^Chapter 45:.*": "Chapter 45: Descriptive of an Affecting Interview Between Mr. Samuel Weller and a Family Party. Mr. Pickwick Makes a Tour of the Diminutive World He Inhabits, and Resolves to Mix with It, in Future, as Little as Possible", r"^Chapter 46:.*": "Chapter 46: Records a Touching Act of Delicate Feeling, Not Unmixed with Pleasantry, Achieved and Performed by Messrs. Dodson and Fogg", r"^Chapter 47:.*": "Chapter 47: Is Chiefly Devoted to Matters of Business, and the Temporal Advantage of Dodson and Fogg--Mr. Winkle Reappears Under Extraordinary Circumstances--Mr. Pickwick’s Benevolence Proves Stronger Than His Obstinacy", r"^Chapter 48:.*": "Chapter 48: Relates How Mr. Pickwick, with the Assistance of Samuel Weller, Essayed to Soften the Heart of Mr. Benjamin Allen, and to Mollify the Wrath of Mr. Robert Sawyer", r"^Chapter 50:.*": "Chapter 50: How Mr. Pickwick Sped upon His Mission, and How He Was Reinforced in the Outset by a Most Unexpected Auxiliary", r"^Chapter 51:.*": "Chapter 51: In Which Mr. Pickwick Encounters an Old Acquaintance--To Which Fortunate Circumstance the Reader Is Mainly Indebted for Matter of Thrilling Interest Herein Set Down, Concerning Two Great Public Men of Might and Power", r"^Chapter 52:.*": "Chapter 52: Involving a Serious Change in the Weller Family, and the Untimely Downfall of Mr. Stiggins", r"^Chapter 53:.*": "Chapter 53: Comprising the Final Exit of Mr. Jingle and Job Trotter, with a Great Morning of Business in Gray’s Inn Square--Concluding with a Double Knock at Mr. Perker’s Door", r"^Chapter 54:.*": "Chapter 54: Containing Some Particulars Relative to the Double Knock, and Other Matters: Among Which Certain Interesting Disclosures Relative to Mr. Snodgrass and a Young Lady Are by No Means Irrelevant to This History", r"^Chapter 55:.*": "Chapter 55: Mr. Solomon Pell, Assisted by a Select Committee of Coachmen, Arranges the Affairs of the Elder Mr. Weller", r"^Chapter 56:.*": "Chapter 56: An Important Conference Takes Place Between Mr. Pickwick and Samuel Weller, at Which His Parent Assists--An Old Gentleman in a Snuff-Coloured Suit Arrives Unexpectedly", r"^Chapter 57:.*": "Chapter 57: In Which the Pickwick Club Is Finally Dissolved, and Everything Concluded to the Satisfaction of Everybody"}}),
}


# ── Download ──

def download(cache: str, gid: int) -> str:
    path = os.path.join(cache, f"pg{gid}.txt")
    if not os.path.exists(path):
        url = f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        data = urllib.request.urlopen(req, timeout=120).read()
        with open(path, "wb") as f:
            f.write(data)
        time.sleep(1)
    with open(path, encoding="utf-8-sig") as f:
        return f.read()


def gutenberg_body(raw: str) -> str:
    """The text between the *** START OF / *** END OF markers."""
    raw = raw.replace("\r", "").replace("\ufeff", "")
    start = re.search(r"^\*\*\* ?START OF.*$", raw, re.M)
    end = re.search(r"^\*\*\* ?END OF.*$", raw, re.M)
    return raw[start.end() if start else 0: end.start() if end else len(raw)]


# ── Cleaning ──

ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
         "nineteen", "twenty"]
ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
            "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth",
            "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"]
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90}
TENS_ORD = {"twentieth": 20, "thirtieth": 30, "fortieth": 40, "fiftieth": 50, "sixtieth": 60}


def number(tok: str) -> int | None:
    """'XIV' / '14' / 'fourteen' / 'Fourteenth' / 'twenty-one' -> 14, 21; else None."""
    t = tok.strip(".:").replace("—", "-")
    if t.isdigit():
        return int(t)
    if re.fullmatch(r"[IVXLCDM]+", t):
        n = 0
        for a, b in zip(t, t[1:] + " "):
            v = ROMAN[a]
            n += -v if b != " " and ROMAN[b] > v else v
        return n
    t = t.lower()
    for table in (WORDS, ORDINALS):
        if t in table:
            return table.index(t)
    m = re.fullmatch(r"(\w+)[- ](\w+)", t)
    if m and m[1] in TENS:
        unit = m[2]
        for table in (WORDS, ORDINALS):
            if unit in table and 0 < table.index(unit) < 10:
                return TENS[m[1]] + table.index(unit)
    return TENS.get(t) or TENS_ORD.get(t)


SMALL = {"a", "an", "the", "and", "but", "or", "nor", "of", "in", "on", "at", "to", "by", "for",
         "with", "from", "as", "into", "upon", "de", "la", "le", "du", "von", "van"}


def titlecase(s: str) -> str:
    """Title case for ALL-CAPS headings; anything already mixed-case is left alone."""
    if any(c.islower() for c in s):
        return s
    out = []
    for i, w in enumerate(re.split(r"(?<=—)|\s", s)):
        lw = w.lower()
        if i and lw in SMALL:
            out.append(lw)
        elif re.fullmatch(r"[IVXLC]+[.,:]?", w) and w not in ("I", "LIVE"):
            out.append(w)  # roman numerals stay
        else:
            out.append("-".join(p[:1].upper() + p[1:] for p in lw.split("-")) if lw else lw)
            out[-1] = re.sub(r"^([\"“‘'(\[])(\w)", lambda m: m[1] + m[2].upper(), out[-1])
    return re.sub(r"— ", "—", " ".join(out))


def clean_inline(text: str) -> str:
    """Markup removal on the raw text (bepub's cleanContent rules, plus footnote markers)."""
    text = re.sub(r"\[_?Copyright[^\]]*\]", "", text)
    text = re.sub(r"\[Illustration[^\]]*\]", "", text, flags=re.S)
    text = re.sub(r"\[(?:Footnote|Sidenote|Transcriber|Note)[^\]]*\]", "", text, flags=re.S | re.I)
    text = re.sub(r"\^\{[^}]*\}", "", text)
    text = re.sub(r"\^(\w)", r"\1", text)
    text = re.sub(r"\{[^}]{1,60}\}", "", text)
    text = re.sub(r"(?m)^[ \t]*\*Transcriber[’']?s? [Nn]otes?\b.*(?:\n(?![ \t]*\n).*)*", "", text)
    text = re.sub(r"(?m)^[ \t]*(?:\(\*\d+\)|\[\d{1,3}\]).*(?:\n(?![ \t]*\n).*)*", "", text)  # footnote paragraphs
    text = re.sub(r"\[\d{1,3}\]|\[[a-z]\]|\(\*\d+\)", "", text)  # footnote markers
    text = text.replace("_", "")
    text = re.sub(r"/\* ?(?:NIND ?)?| ?\*/", "", text)  # /* NIND ... */ letter markup
    text = re.sub(r"(?m)^[ \t]*(?:\*[ \t]*){2,}$", "", text)  # * * * dividers
    text = re.sub(r"(?m)^[ \t]*[-=~·.]{3,}[ \t]*$", "", text)
    text = re.sub(r"(?m)^[ \t]*(?:ACT DROP|CURTAIN\.?)[ \t]*$", "", text)
    text = re.sub(r"(?mi)^[ \t]*end of (?:the )?(?:first|second|third|fourth|fifth|\w+) (?:volume|part|book)\.?[ \t]*$", "", text)
    text = re.sub(r"\(Mem\.,?[^)]*\)|\(Kept in [^)]*\)", "", text)
    text = re.sub(r"(?m)^.*\.(?:jpg|jpeg|png|gif) \(\d+K\)\s*$|^\s*Full Size\s*$", "", text)
    return text


def is_verse(lines: list[str]) -> bool:
    """A block is verse (keep its line breaks) when its lines start with capitals, as verse lines
    do and wrapped prose lines don't, or when they mostly stop short of the wrap width and only
    rarely start in lowercase."""
    if len(lines) < 2:
        return False
    lower = sum(1 for l in lines[1:] if l.strip()[:1].islower()) / (len(lines) - 1)
    if lower == 0 and len(lines) >= 3:
        return True
    short = sum(1 for l in lines[:-1] if len(l.strip()) < 55) / (len(lines) - 1)
    return short > 0.5 and lower < 0.2


def unwrap(block: str) -> str:
    lines = [l.rstrip() for l in block.split("\n") if l.strip()]
    indent = min(len(l) - len(l.lstrip()) for l in lines)
    joined = []
    for l in lines:  # a long verse line's wrapped tail is indented further and starts in lowercase
        if joined and len(l) - len(l.lstrip()) >= indent + 3 and l.strip()[:1].islower():
            joined[-1] += " " + l.strip()
        else:
            joined.append(l)
    lines = joined
    if is_verse(lines):
        return "\n".join(re.sub(r"\s+", " ", l.strip()) for l in lines)
    return re.sub(r"\s+", " ", " ".join(l.strip() for l in lines)).strip()


def blocks_to_content(blocks: list[str]) -> str:
    paras = [unwrap(b) for b in blocks]
    # section numbers ("1.", "II") between paragraphs are headings, not text
    return "\n\n".join(p for p in paras if re.search(r"\w", p) and not re.fullmatch(r"[IVXLC\d]+\.?", p))


# ── Headings ──

KIND = r"(?:CHAPTER|Chapter|BOOK|Book|PART|Part|VOLUME|Volume|STAVE|Stave|LETTER|Letter|ACT|Act|SCENE|Scene|CANTO|Canto|ADVENTURE|EPISODE|Episode|SECTION|Section)"
NUMTOK = r"(?:[IVXLCDM]+|\d+|[A-Za-z]+(?:[- ][A-Za-z]+)?)"
SEP = r"(?:\s*[.:—–-]\s*|\s+)"
SPECIAL = r"(?:THE\s+)?(?:PROLOGUE|EPILOGUE|Prologue|Epilogue|CONCLUSION|Conclusion|PREFACE|Preface|INTRODUCTION|Introduction|AFTERWORD|POSTSCRIPT|FINALE|Finale|PRELUDE|Prelude)"
GENERIC = [  # (level, regex): 0 = book/part/act, 1 = chapter/scene, 2 = bare numeral
    (None, rf"(?P<kind>{KIND})\.?\s+(?:THE\s+|the\s+)?(?P<num>{NUMTOK})\b\.?(?:{SEP}(?P<rest>.*))?"),
    (0, r"(?:THE\s+)?(?P<num>FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+(?P<kind>PART|BOOK|ACT)\.?(?:" + SEP + r"(?P<rest>.*))?"),
    (2, rf"(?P<num>[IVX]|[IVXLC]{{2,}})\.?(?:{SEP}(?P<rest>[A-Z“‘\"'].*))?"),
    (1, rf"(?P<kind>{SPECIAL})\.?(?:{SEP}(?P<rest>.*))?"),
]
MAJOR = {"book", "part", "volume", "act"}
FOLD = 9  # a sub-heading whose text stays in the chapter it is in
BACK_MATTER = r"(?i:footnotes?:?|notes:?|notes to the \w+ volume|endnotes|index|glossary|transcriber.*|appendix.*|the end\.?|finis\.?)"
EDITORIAL = r".*\b(?:[Tt]ranslator|[Ee]ditor|[Tt]ranscriber)\b.*|(?:Introduction|Preface|Foreword).*\b[Bb]y [A-Z].*"


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def toc_entries(lines: list[str]) -> dict[str, str]:
    """Entries of the first contents list (normalised -> as printed): the short lines after a
    'Contents' line, until a wider gap between lines than between its first two entries."""
    for i, l in enumerate(lines):
        if re.fullmatch(r"\s*(?:Table of )?CONTENTS?[.:]?", l, re.I):
            out, blank, gap = [], 0, None
            for l2 in lines[i + 1:]:
                if not l2.strip():
                    blank += 1
                    continue
                if out and gap is None:
                    gap = blank
                if len(l2.strip()) > 80 or (gap is not None and blank > gap + 1):
                    break
                blank = 0
                entry = re.sub(r"\s{2,}(?:\d+|[ivxlc]+)$", "", l2.strip())
                if out and norm(entry) == norm(out[0]):
                    break  # the text itself has begun
                out.append(entry)
            return {norm(e): e for e in out if norm(e) and norm(e) != "page"}
    return {}


def match_heading(line: str, opts: dict, toc: dict[str, str]):
    """-> (level, kind, number, rest) for a heading line, or None."""
    s = line.strip()
    if not s or len(s) > 110 or re.search(r"\s{2,}\d+$|\.{4,}", s):
        return None  # contents entries end in page numbers
    heads = opts.get("heads", [])
    for m in (re.fullmatch(hp, s) for hp in ([heads] if isinstance(heads, str) else heads)):
        if m:
            g = m.groupdict()
            if g.get("fold"):
                return (FOLD, "", None, g["fold"])
            kind = (g.get("kind") or "").strip()
            rest = g["rest"] if "rest" in g else (None if "num" in g else s)
            return (0 if kind.lower() in MAJOR | {"section"} else 1, kind, g.get("num"), (rest or "").strip())
    if norm(s) in toc and (s == toc[norm(s)] or not re.search(r"[a-z]", s)):
        return (1, "", None, s)
    if opts.get("heads_only"):
        return None
    for level, pat in GENERIC:
        m = re.fullmatch(pat, s)
        if not m:
            continue
        g = m.groupdict()
        kind = g.get("kind") or ""
        num = g.get("num")
        if num is not None and number(num) is None and num.upper() != "LAST":
            continue
        rest = (g.get("rest") or "").strip()
        if kind and num and not kind.isupper() and rest and rest[0].islower():
            continue  # "Chapter one of the story..." is prose
        if rest and (len(rest) > 90 or rest.endswith((",", ";"))):
            continue
        if not kind and rest and any(w[0].islower() and w.lower() not in SMALL for w in rest.split()):
            continue  # "I TEACH YOU THE SUPERMAN. Man is something..." is prose
        if level is None:
            level = 0 if kind.lower() in MAJOR else 1
        return (level, kind, num, rest)
    return None


def heading_title(h, opts: dict) -> str:
    level, kind, num, rest = h
    rest = titlecase(rest.strip(" .:—–-")) if rest else ""
    if num is None:
        name = titlecase(re.sub(r"^(?:THE|The)\s+", "", kind)) if kind else ""
    elif num.upper() == "LAST":
        name = f"{titlecase(kind)} the Last"
    else:
        name = f"{(titlecase(kind) if kind else opts.get('label', 'Chapter'))} {number(num)}"
    if name and rest:
        return f"{name}: {rest}"
    return name or rest


# ── Splitting ──

def is_prose(block: str) -> bool:
    lines = block.split("\n")
    return len(block) >= 200 and not is_verse(lines)


def split_book(body: str, opts: dict) -> list[dict]:
    lines = body.split("\n")
    toc = toc_entries(clean_inline(body).split("\n")) if opts.get("toc") else {}
    if opts.get("start"):
        idx = [i for i, l in enumerate(lines) if re.fullmatch(opts["start"], l.strip())]
        if not idx:
            raise SystemExit(f"start not found: {opts['start']}")
        lines = lines[idx[opts.get("start_n", 0)]:]
        if opts.get("first") and len(lines[0].strip()) <= 40 and not re.search(r"[a-z]", lines[0]):
            lines = lines[1:]  # the start line is the heading "first" replaces
    if opts.get("end"):
        idx = [i for i, l in enumerate(lines) if re.fullmatch(opts["end"], l.strip())]
        if not idx:
            raise SystemExit(f"end not found: {opts['end']}")
        lines = lines[: idx[opts.get("end_n", -1)]]
    for cut_start, cut_end in opts.get("cut", []):
        out, cutting = [], False
        for l in lines:
            if cutting and re.fullmatch(cut_end, l.strip()):
                cutting = False
            elif not cutting and re.fullmatch(cut_start, l.strip()):
                cutting = True
            if not cutting:
                out.append(l)
        lines = out
    text = "\n".join(lines)
    if opts.get("gloss"):  # Purves' Chaucer: glosses in the right margin, *starred* words, <n> notes
        text = re.sub(r"(?m)[ \t]{3,}\*[^\n]*$", "", text)
        text = re.sub(r"(?m)^[ \t]{25,}\S[^\n]*$", "", text)
        text = re.sub(r"<\w{1,3}>", "", text).replace("*", "")
        text = re.sub(r"\[[^\]\n]{1,80}\]", "", text)
    text = clean_inline(text)
    if opts.get("strip"):
        text = re.sub(rf"(?m)^[ \t]*(?:{opts['strip']})[ \t]*$", "", text)
    lines = text.split("\n")

    # blocks: runs of non-blank lines
    blocks, cur = [], []
    for l in lines + [""]:
        if l.strip():
            cur.append(l)
        elif cur:
            blocks.append(cur)
            cur = []

    # sections: a heading block starts one; its title may take a subtitle from the rest of the
    # block or from the next short block
    sections = [[1, opts["first"], [], True]] if opts.get("first") else []  # [level, title, blocks, named]
    pre = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if len(b) >= 2 and re.fullmatch(KIND, b[0].strip()):
            b = [f"{b[0].strip()} {b[1].strip()}"] + b[2:]  # "CHAPTER" / "1" on two lines
        if len(b) <= 2 and re.fullmatch(BACK_MATTER, b[0].strip()) and i > len(blocks) * 0.8 \
                and not re.fullmatch(opts.get("keep", "$^"), b[0].strip()):
            break  # back matter: everything after is dropped
        h = match_heading(b[0], opts, toc) if len(b) <= 4 and sum(len(x) for x in b) < 240 else None
        if len(b) == 1 and re.fullmatch(r"(?:TABLE OF )?CONTENTS?[.:]?|Contents[.:]?", b[0].strip()):
            i += 1  # a contents list: skip it and the entry blocks that follow
            while i < len(blocks) and all(len(x.strip()) <= 80 for x in blocks[i]) \
                    and (len(blocks[i]) > 1 or not match_heading(blocks[i][0], opts, toc)) \
                    and not any(is_prose("\n".join(x)) for x in blocks[i:i + 2]):
                i += 1
            continue
        if h is None:
            (sections[-1][2] if sections else pre).append("\n".join(b))
            i += 1
            continue
        level, kind, num, rest = h
        extra = [x.strip() for x in b[1:]]
        if num is None and not extra and norm(b[0]) not in toc and i + 1 < len(blocks) and len(blocks[i + 1]) == 1:
            nxt = blocks[i + 1][0].strip()  # "THE CUSTOM-HOUSE" / "INTRODUCTORY TO ..."
            if re.sub(r"[^A-Za-z]", "", nxt).isupper() and len(nxt) <= 100 and not match_heading(nxt, opts, toc):
                rest = f"{titlecase(rest)}: {titlecase(nxt)}" if rest else nxt
                i += 1
        if not rest and extra:
            rest = " ".join(extra)
        elif not rest and i + 1 < len(blocks) and len(blocks[i + 1]) <= 2 and not opts.get("nosub"):
            nxt = " ".join(x.strip() for x in blocks[i + 1])
            letters = re.sub(r"[^A-Za-z]", "", nxt)
            upper = letters and letters.isupper() and len(nxt) <= 160 and nxt not in ("I", "A", "O", "SCENE")
            titled = opts.get("sub") and len(nxt) <= 80 and not nxt.endswith((",", ";"))
            if (upper or titled) and not match_heading(blocks[i + 1][0], opts, toc) \
                    and not match_heading(nxt, opts, toc):
                rest = nxt
                i += 1
        sections.append([level, heading_title((level, kind, num, rest), opts), [], num is None])
        i += 1

    # front matter: drop everything before the first section that holds prose (or a scene's
    # worth of short blocks), keeping the empty parent headings right above it
    def listing(block):  # a contents list: most lines are numbered or headings
        ls = block.split("\n")
        return sum(bool(re.match(rf"\s*(?:{KIND}\b|[IVXLC]+\.|\d+\.)", l)) for l in ls) > len(ls) * 0.3

    def has_text(blks):  # prose, a poem, or a scene's worth of speeches
        return (any(is_prose(x) or (len(x) >= 400 and not listing(x)) for x in blks)
                or (len(blks) >= 8 and sum(map(len, blks)) >= 40 * len(blks)))

    first = next((k for k, s in enumerate(sections) if has_text(s[2])), None)
    if first is None:
        return split_long([{"title": "", "content": blocks_to_content(pre)}]) if pre else []
    # (with at most a line or two under them: a contents list there is front matter)
    while first > 0 and sections[first - 1][0] < sections[first][0] \
            and all(x.count("\n") < 3 for x in sections[first - 1][2]) and not has_text(sections[first - 1][2]):
        first -= 1
    sections = sections[first:]
    drop = opts.get("drop", EDITORIAL)
    kept, dropping = [], False
    for sec in sections:  # a dropped section takes its folded sub-sections with it
        if sec[0] != FOLD:
            dropping = bool(drop and re.fullmatch(drop, sec[1]))
        if not dropping:
            kept.append(sec)
    sections = kept

    # chapter level: the numbered headings below book/part level; finer headings (section
    # numerals inside chapters) are folded into their chapter, coarser ones become parents
    # named headings (Preface, Epilogue, story titles...) are always chapters of their own
    counts = {}
    for s in sections:
        if 0 < s[0] < FOLD and not re.match(SPECIAL, s[1], re.I):
            counts[s[0]] = counts.get(s[0], 0) + 1
    chapter_level = opts.get("level", min((l for l, n in counts.items() if n >= 2), default=0))
    chapters, parent, carry = [], None, []
    for k, (lvl, title, blks, named) in enumerate(sections):
        if named and not has_text(blks) and k + 1 < len(sections) and not sections[k + 1][3] \
                and sections[k + 1][0] == chapter_level:
            parent, carry = title, carry + blks  # "EPILOGUE" over its own Chapter 1, 2...
            continue
        if lvl == FOLD or (named and chapters and title == chapters[-1]["title"]):
            chapters[-1]["blocks"] += blks  # a story's title repeated over its last part
            continue
        if named:
            lvl = chapter_level
        if lvl > chapter_level and chapters:
            chapters[-1]["blocks"] += blks
            continue
        if lvl < chapter_level:
            parent = title
            if any(is_prose(x) for x in blks) and sum(len(x) for x in blks) >= 300:
                chapters.append({"title": title, "blocks": blks, "parent": None})
            else:
                carry += blks
            continue
        chapters.append({"title": title, "blocks": carry + blks, "parent": None if named else parent})
        carry = []
    titles = [c["title"].split(":")[0] for c in chapters if c["parent"]]
    if len(set(titles)) < len(titles):  # numbering restarts in each part
        for c in chapters:
            if c["parent"]:
                c["title"] = f"{c['parent'].split(':')[0]}, {c['title']}"
    out = [{"title": c["title"], "content": blocks_to_content(c["blocks"])} for c in chapters]
    out = [c for c in out if c["content"]]
    merged = []
    for c in out:  # a few lines (a short poem, an epigraph) join the chapter before
        if merged and len(c["content"]) < 300:
            merged[-1]["content"] += f"\n\n{c['title']}\n\n{c['content']}" if c["title"] else f"\n\n{c['content']}"
        else:
            merged.append(c)
    out = merged
    for pat, repl in opts.get("titles", {}).items():
        for c in out:
            c["title"] = re.sub(pat, repl, c["title"])
    seen = {}
    for c in out:  # two poems both called "To Helen"
        seen[c["title"]] = seen.get(c["title"], 0) + 1
        if seen[c["title"]] > 1:
            c["title"] += f" ({seen[c['title']]})"
    if len(out) == 1 and len(out[0]["content"]) > 60000:
        return split_long(out)
    return out


def split_long(chapters: list[dict], target: int = 20000) -> list[dict]:
    """One undivided text -> parts of ~target chars at paragraph boundaries."""
    text = "\n\n".join(c["content"] for c in chapters)
    paras, parts, cur = text.split("\n\n"), [], ""
    for p in paras:
        if cur and len(cur) + len(p) > target:
            parts.append(cur)
            cur = ""
        cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        if parts and len(cur) < target / 3:
            parts[-1] += "\n\n" + cur
        else:
            parts.append(cur)
    return [{"title": f"Part {i + 1}", "content": c} for i, c in enumerate(parts)]


# ── Catalogue metadata ──

def read_time(words: int) -> str:
    minutes = words / WORDS_PER_MIN
    if minutes < 60:
        return f"{max(15, round(minutes / 15) * 15)}min"
    h, m = divmod(round(minutes / 15) * 15, 60)
    return f"{h}h {m}min" if m else f"{h}h"


def update_catalog_ts():
    src = open(CATALOG_TS, encoding="utf-8").read()

    def fix(m):  # one entry, from its id to its contentPath (entries are multi- or single-line)
        chapters = json.load(open(os.path.join(OUT_DIR, f"{m[1]}.json"), encoding="utf-8"))["chapters"]
        words = sum(len(c["content"].split()) for c in chapters)
        entry = re.sub(r"chapters: \d+,", f"chapters: {len(chapters)},", m[0])
        return re.sub(r"readTime: '[^']*',", f"readTime: '{read_time(words)}',", entry)

    src, n = re.subn(r"id: '([^']+)',[\s\S]*?contentPath", fix, src)
    assert n == len(BOOKS) + len(UNSOURCED), n
    open(CATALOG_TS, "w", encoding="utf-8").write(src)


def volumes(slug: str) -> list[tuple[int, dict]]:
    """(Gutenberg id, options) per volume; a volume may add its own options to the book's."""
    ids, opts = BOOKS[slug]
    return [(v, opts) if isinstance(v, int) else (v[0], {**opts, **v[1]})
            for v in (ids if isinstance(ids, tuple) else (ids,))]


def build(cache: str, slug: str) -> list[dict]:
    chapters = []
    for gid, opts in volumes(slug):
        chapters += split_book(gutenberg_body(download(cache, gid)), opts)
    return chapters


def main():
    cache, *slugs = sys.argv[1:]
    os.makedirs(cache, exist_ok=True)
    for slug in slugs or BOOKS:
        chapters = build(cache, slug)
        with open(os.path.join(OUT_DIR, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump({"chapters": chapters}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{slug}: {len(chapters)} chapters, {sum(len(c['content']) for c in chapters):,} chars", flush=True)
    update_catalog_ts()


if __name__ == "__main__":
    main()
