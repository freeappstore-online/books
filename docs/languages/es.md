# Spanish edition: research and catalogue

The first language app (books#59). Why Spanish goes first: [README.md](README.md). This page is
everything to settle before the app is built: name, rights rule, voice, sources, the first catalogue
and the SEO plan. Each item marked **Owner** needs a decision.

## Name and address

**Owner.** The recommendation:

- App id `libros`, store name **Libros**, at `libros.freeappstore.online`. The id is free in the
  registry today.
- A Spanish word in the address and title helps searches in Spanish ("libros clásicos gratis",
  "audiolibros").
- `spanish-books` reads as a tool for learners rather than a library for native readers.

The interface uses neutral international Spanish: *tú*, not *vos*, and *ustedes*, not *vosotros*.
Dates and numbers follow `es` (books#54).

## Rights rule

The app is used worldwide, so a book should be public domain wherever most of its readers are. The
terms that matter:

- **United States:** works first published before 1931 are public domain in 2026. That is
  Gutenberg's basis.
- **Spain:** life + 80 for authors who died before 7 December 1987, so authors who died before 1946.
- **Colombia:** life + 80.
- **Argentina, Chile, the EU:** life + 70.
- **Mexico:** life + 100 for authors who died since 2003. Older deaths keep the shorter terms in
  force at the time, and the transition rules are disputed.

**Owner.** The proposed rule has two tiers:

- **Tier A:** the author (and any translator or editor whose text is kept) died more than 100 years
  ago, in 1925 or earlier. Public domain everywhere, Mexico included.
- **Tier B:** the author died between 1926 and 1945, and the work was first published before 1931.
  Public domain in the US, Spain, the EU and South America. Possibly not in Mexico, depending on how
  its transition rules are read.

The first catalogue below has 40 Tier A books and 11 Tier B books, all named. Shipping only Tier A
loses Unamuno, Machado, Lorca, Quiroga, Blasco Ibáñez and Palacio Valdés until 2029–2039.

The **Recommendation** is to ship both tiers, as the English catalogue does on the US basis (books#21).

Excluded under either tier, because the author died in 1946 or later:

- Juan Ramón Jiménez (*Platero y yo*, †1958);
- Pío Baroja (†1956);
- Jacinto Benavente (†1954);
- Azorín (†1967);
- Ortega y Gasset (†1955);
- Rómulo Gallegos;
- Mariano Azuela.

Translations of world classics into Spanish (Gutenberg has *El crimen y el castigo*, *La Odisea*,
*Los miserables*…) are left out of the first catalogue. Each translator's death date would need
checking, and several are unknown.

## Voice

Kokoro v1.0 has three Spanish voices: `ef_dora` (female), `em_alex` and `em_santa` (male).

- **Grade:** `VOICES.md` gives them none.
- **Intelligibility:** on the opening of *Don Quijote*, Whisper transcribed all three with 11–12% word
  error, about the same as the French and Italian voices. Nearly all of it is numbers written as
  digits and archaic words ("adarga", "rocín").
- **Questions:** Whisper transcribed `¿…?` dialogue as questions.
- **Roman numerals:** "Capítulo XII" came out as "Capítulo doce", which is right.
- **Pronunciation:** the voices use espeak's Spanish rules. Spanish is spelled almost exactly as it
  sounds, so it suits rule-based pronunciation better than French or English.

**Owner.** Listen to the three samples (same passage, generated 2026-11-11) and pick the narrator.
They were made with `kokoro-onnx` and the same v1.0 model files the
*Generate audio* workflow downloads: `Kokoro(model, voices).create(text, voice=..., lang="es")` on the
first paragraph of *Don Quijote*. Before each batch, also listen to
two minutes of a book with dialect dialogue (*Martín Fierro*, *Sotileza*) and of one in old spelling
(*La Celestina*). Those stay reading-only if they sound wrong.

Narration goes to its own dataset, `serge-ivo/books-audio-es`, in the same layout as English
(books#57).

## Sources

- **Gutenberg first.** It has 914 Spanish texts. 57 candidates were downloaded and checked for:
  - English mixed into the text (a US school edition carries English notes and vocabulary);
  - chapter headings;
  - editors whose prefaces are still in copyright.

  50 can be used as they are, or by dropping a preface.
- **Unusable on Gutenberg:**
  - US school editions with English notes and vocabulary (5–12% English words): *Doña Perfecta*
    (15725), *El sombrero de tres picos* (29506), *El estudiante de Salamanca* (15781) and
    *La Navidad en las montañas* (10825).
  - *Don Juan Tenorio* (5201): bilingual, with a modern English translation.
  - The Tirso volume (58194): it doesn't contain *El burlador de Sevilla*, and its editor (†1976)
    is in copyright.
- **Missing from Gutenberg:** *María* (Jorge Isaacs), *Amalia* (José Mármol), *El Periquillo
  Sarniento* (Lizardi).
- **Wikisource (books#55) supplies:**
  - *Don Juan Tenorio* (Zorrilla, †1893);
  - *El burlador de Sevilla* (Tirso de Molina, †1648);
  - *Doña Perfecta* (Galdós);
  - *El sombrero de tres picos* (Alarcón, †1891);
  - *El estudiante de Salamanca* (Espronceda, †1842);
  - *María* (Isaacs, †1895);
  - *Amalia* (Mármol, †1871);
  - *El Periquillo Sarniento* (Fernández de Lizardi, †1827).

  The pilot can launch without them.
- **Splitting:** Spanish Gutenberg texts mark chapters as `CAPÍTULO`, `Capítulo`, `TRATADO`, `PARTE`,
  `LIBRO`, `JORNADA`, `ACTO`, `ESCENA`, `CANTO`, or as bare Roman numerals in decorations (`-I-`,
  `--I--`, `I.`). The Spanish language profile (books#56) needs all of these, plus ordinal words
  (`PRIMERA PARTE`), `¿¡` and the em-dash that opens dialogue.

## The first catalogue

51 books: 40 Tier A and 11 Tier B. Together they are about 24.5M characters, or about 450 hours of
narration at the English rate (8.2M characters ≈ 150 h, books#4). That's well inside the 250 MB
deploy limit.

- **Text** is the size of the Gutenberg file between its markers, before cleaning.
- **Narration** is that size converted at the English rate.
- **Wave** is the narration order:
  - **1:** the pilot's narrated books. Short, Tier A, plain prose: *Lazarillo de Tormes*,
    *Pepita Jiménez*, *Marianela*, *Misericordia* and *Tradiciones peruanas*, about 27 h together.
  - **2:** *Don Quijote*, the flagship (about 39 h).
  - The rest come after the pilot, as the English catalogue did.

Every book is checked by hand when it is added, as in books#21: the chapter list, the first and last
lines, and that no Gutenberg or editor text is left. The notes say where a book needs split options
or a dropped preface.

### Spain: Golden Age and before

| Gutenberg | Slug | Title | Author | Tier | Wave | Text | Narration | Notes |
|---|---|---|---|---|---|---|---|---|
| [2000](https://www.gutenberg.org/ebooks/2000) | `don-quijote` | *Don Quijote de la Mancha* | Miguel de Cervantes (†1616) | A | 2 | 2,111k | 38.6 h | Both parts; 126 chapter headings. The flagship for search. |
| [61202](https://www.gutenberg.org/ebooks/61202) | `novelas-ejemplares` | *Novelas ejemplares* | Miguel de Cervantes (†1616) | A |  | 1,035k | 18.9 h | Brockhaus edition. Split on the twelve novella titles (`heads`). |
| [320](https://www.gutenberg.org/ebooks/320) | `lazarillo-de-tormes` | *Lazarillo de Tormes* | Anónimo | A | 1 | 107k | 1.9 h | Seven tratados. Short and widely taught. |
| [1619](https://www.gutenberg.org/ebooks/1619) | `la-celestina` | *La Celestina* | Fernando de Rojas (†1541) | A |  | 669k | 12.2 h | Old file (legacy licence header). Check who wrote its introduction. Old spelling ("auctor", "vn"): reading only until a listening test. |
| [32315](https://www.gutenberg.org/ebooks/32315) | `el-buscon` | *Historia de la vida del Buscón* | Francisco de Quevedo (†1645) | A |  | 235k | 4.3 h |  |
| [60198](https://www.gutenberg.org/ebooks/60198) | `fuenteovejuna` | *Fuente Ovejuna* | Lope de Vega (†1635) | A |  | 97k | 1.8 h | Verse drama: reading only at first (one voice for every part). |
| [54436](https://www.gutenberg.org/ebooks/54436) | `la-vida-es-sueno` | *La vida es sueño* | Pedro Calderón de la Barca (†1681) | A |  | 507k | 9.3 h | Volume 1 of *Teatro selecto*: take only this play (`start`/`end`). Introduction by Menéndez y Pelayo (†1912). |
| [65738](https://www.gutenberg.org/ebooks/65738) | `el-conde-lucanor` | *El conde Lucanor* | Don Juan Manuel (†1348) | A |  | 456k | 8.3 h | Prologue and notes by F. J. Sánchez Cantón (†1971) are still in copyright: drop them, or use Wikisource. |
| [49333](https://www.gutenberg.org/ebooks/49333) | `coplas-por-la-muerte-de-su-padre` | *Coplas por la muerte de su padre* | Jorge Manrique (†1479) | A |  | 28k | 0.5 h | Critical edition by Foulché-Delbosc (†1929): keep only the poem. |

### Spain: 18th and 19th centuries

| Gutenberg | Slug | Title | Author | Tier | Wave | Text | Narration | Notes |
|---|---|---|---|---|---|---|---|---|
| [50027](https://www.gutenberg.org/ebooks/50027) | `el-si-de-las-ninas` | *El sí de las niñas* | Leandro Fernández de Moratín (†1828) | A |  | 107k | 2.0 h | Prose comedy. |
| [59492](https://www.gutenberg.org/ebooks/59492) | `don-alvaro` | *Don Álvaro o la fuerza del sino* | Duque de Rivas (†1865) | A |  | 149k | 2.7 h |  |
| [55206](https://www.gutenberg.org/ebooks/55206) | `fabulas-samaniego` | *Fábulas* | Félix María de Samaniego (†1801) | A |  | 297k | 5.4 h |  |
| [29497](https://www.gutenberg.org/ebooks/29497) | `fabulas-literarias` | *Fábulas literarias* | Tomás de Iriarte (†1791) | A |  | 113k | 2.1 h | Oxford edition by J. Fitzmaurice-Kelly (†1923). Drop its English imprint lines. |
| [53552](https://www.gutenberg.org/ebooks/53552) | `rimas-y-leyendas` | *Rimas y leyendas (Obras escogidas)* | Gustavo Adolfo Bécquer (†1870) | A |  | 554k | 10.1 h | Drop the introduction by the Álvarez Quintero brothers (†1938, †1944). |
| [31541](https://www.gutenberg.org/ebooks/31541) | `articulos-de-figaro` | *Fígaro: artículos selectos* | Mariano José de Larra (†1837) | A |  | 514k | 9.4 h |  |
| [23600](https://www.gutenberg.org/ebooks/23600) | `la-gaviota` | *La gaviota* | Fernán Caballero (†1877) | A |  | 531k | 9.7 h |  |
| [17223](https://www.gutenberg.org/ebooks/17223) | `pepita-jimenez` | *Pepita Jiménez* | Juan Valera (†1905) | A | 1 | 315k | 5.8 h | Three parts, split by their own headings. |
| [17340](https://www.gutenberg.org/ebooks/17340) | `marianela` | *Marianela* | Benito Pérez Galdós (†1920) | A | 1 | 294k | 5.4 h | Chapters marked "-I-". |
| [16961](https://www.gutenberg.org/ebooks/16961) | `trafalgar` | *Trafalgar* | Benito Pérez Galdós (†1920) | A |  | 300k | 5.5 h | First of the *Episodios nacionales*. |
| [17013](https://www.gutenberg.org/ebooks/17013) | `fortunata-y-jacinta` | *Fortunata y Jacinta* | Benito Pérez Galdós (†1920) | A |  | 2,241k | 41.0 h | Four parts. Very long. |
| [21831](https://www.gutenberg.org/ebooks/21831) | `misericordia` | *Misericordia* | Benito Pérez Galdós (†1920) | A | 1 | 480k | 8.8 h |  |
| [66979](https://www.gutenberg.org/ebooks/66979) | `tristana` | *Tristana* | Benito Pérez Galdós (†1920) | A |  | 303k | 5.5 h |  |
| [52392](https://www.gutenberg.org/ebooks/52392) | `miau` | *Miau* | Benito Pérez Galdós (†1920) | A |  | 559k | 10.2 h |  |
| [15206](https://www.gutenberg.org/ebooks/15206) | `torquemada-en-la-hoguera` | *Torquemada en la hoguera* | Benito Pérez Galdós (†1920) | A |  | 361k | 6.6 h |  |
| [17073](https://www.gutenberg.org/ebooks/17073) | `la-regenta` | *La Regenta* | Leopoldo Alas, "Clarín" (†1901) | A |  | 1,786k | 32.7 h | Chapters marked "--I--". Very long. |
| [62361](https://www.gutenberg.org/ebooks/62361) | `el-senor-y-los-demas-son-cuentos` | *El Señor y los demás son cuentos* | Leopoldo Alas, "Clarín" (†1901) | A |  | 299k | 5.5 h | Includes "¡Adiós, Cordera!". |
| [18005](https://www.gutenberg.org/ebooks/18005) | `los-pazos-de-ulloa` | *Los pazos de Ulloa* | Emilia Pardo Bazán (†1921) | A |  | 494k | 9.0 h |  |
| [55514](https://www.gutenberg.org/ebooks/55514) | `cuentos-de-amor` | *Cuentos de amor* | Emilia Pardo Bazán (†1921) | A |  | 375k | 6.9 h | Drop the *Obras completas* front matter. |
| [49388](https://www.gutenberg.org/ebooks/49388) | `sotileza` | *Sotileza* | José María de Pereda (†1906) | A |  | 665k | 12.2 h | Cantabrian dialect in dialogue: listen before narrating. |

### Latin America and the Philippines

| Gutenberg | Slug | Title | Author | Tier | Wave | Text | Narration | Notes |
|---|---|---|---|---|---|---|---|---|
| [14765](https://www.gutenberg.org/ebooks/14765) | `martin-fierro` | *El gaucho Martín Fierro* | José Hernández (†1886) | A |  | 66k | 1.2 h | Gaucho dialect ("naides"): listen before narrating. |
| [33267](https://www.gutenberg.org/ebooks/33267) | `facundo` | *Facundo* | Domingo Faustino Sarmiento (†1888) | A |  | 602k | 11.0 h |  |
| [21282](https://www.gutenberg.org/ebooks/21282) | `tradiciones-peruanas` | *Tradiciones peruanas* | Ricardo Palma (†1919) | A | 1 | 280k | 5.1 h | Short pieces: good for listening. |
| [52894](https://www.gutenberg.org/ebooks/52894) | `azul` | *Azul...* | Rubén Darío (†1916) | A |  | 193k | 3.5 h |  |
| [50341](https://www.gutenberg.org/ebooks/50341) | `cantos-de-vida-y-esperanza` | *Cantos de vida y esperanza* | Rubén Darío (†1916) | A |  | 83k | 1.5 h |  |
| [75126](https://www.gutenberg.org/ebooks/75126) | `sab` | *Sab* | Gertrudis Gómez de Avellaneda (†1873) | A |  | 327k | 6.0 h |  |
| [28281](https://www.gutenberg.org/ebooks/28281) | `cecilia-valdes` | *Cecilia Valdés* | Cirilo Villaverde (†1894) | A |  | 1,084k | 19.8 h | Long. |
| [22899](https://www.gutenberg.org/ebooks/22899) | `ariel` | *Ariel* | José Enrique Rodó (†1917) | A |  | 156k | 2.9 h | Essay. |
| [19898](https://www.gutenberg.org/ebooks/19898) | `la-edad-de-oro` | *La Edad de Oro* | José Martí (†1895) | A |  | 355k | 6.5 h | For children. Drop the "/P P/" markup. |
| [74087](https://www.gutenberg.org/ebooks/74087) | `sor-juana-obras-selectas` | *Obras selectas* | Sor Juana Inés de la Cruz (†1695) | A |  | 483k | 8.8 h | Edited by Juan León Mera (†1894). |
| [47584](https://www.gutenberg.org/ebooks/47584) | `noli-me-tangere` | *Noli me tángere* | José Rizal (†1896) | A |  | 831k | 15.2 h | Notes by Ramón Sempau (†1909). Widely read in the Philippines. |

### Tier B: author died 1926–1945, every work first published before 1931

| Gutenberg | Slug | Title | Author | Tier | Wave | Text | Narration | Notes |
|---|---|---|---|---|---|---|---|---|
| [49836](https://www.gutenberg.org/ebooks/49836) | `niebla` | *Niebla* | Miguel de Unamuno (†1936) | B |  | 320k | 5.8 h | 1914. |
| [44512](https://www.gutenberg.org/ebooks/44512) | `abel-sanchez` | *Abel Sánchez* | Miguel de Unamuno (†1936) | B |  | 163k | 3.0 h | 1917. |
| [44358](https://www.gutenberg.org/ebooks/44358) | `la-tia-tula` | *La tía Tula* | Miguel de Unamuno (†1936) | B |  | 172k | 3.2 h | 1921. |
| [68525](https://www.gutenberg.org/ebooks/68525) | `poesias-completas-machado` | *Poesías completas* | Antonio Machado (†1939) | B |  | 231k | 4.2 h | 1917 edition. |
| [72665](https://www.gutenberg.org/ebooks/72665) | `romancero-gitano` | *Romancero gitano* | Federico García Lorca (†1936) | B |  | 36k | 0.7 h | 1928. Short. |
| [13507](https://www.gutenberg.org/ebooks/13507) | `cuentos-de-amor-de-locura-y-de-muerte` | *Cuentos de amor de locura y de muerte* | Horacio Quiroga (†1937) | B |  | 293k | 5.4 h | 1917. |
| [24536](https://www.gutenberg.org/ebooks/24536) | `los-cuatro-jinetes-del-apocalipsis` | *Los cuatro jinetes del Apocalipsis* | Vicente Blasco Ibáñez (†1928) | B |  | 802k | 14.7 h | 1919. |
| [14944](https://www.gutenberg.org/ebooks/14944) | `la-barraca` | *La barraca* | Vicente Blasco Ibáñez (†1928) | B |  | 337k | 6.2 h | 1898. |
| [57781](https://www.gutenberg.org/ebooks/57781) | `canas-y-barro` | *Cañas y barro* | Vicente Blasco Ibáñez (†1928) | B |  | 444k | 8.1 h | 1902; this edition 1916. |
| [26983](https://www.gutenberg.org/ebooks/26983) | `sangre-y-arena` | *Sangre y arena* | Vicente Blasco Ibáñez (†1928) | B |  | 658k | 12.0 h | 1908; this edition 1919. |
| [31013](https://www.gutenberg.org/ebooks/31013) | `la-hermana-san-sulpicio` | *La hermana San Sulpicio* | Armando Palacio Valdés (†1938) | B |  | 681k | 12.5 h | 1889. |


## Search and discovery

- **One static page per book** (books#47), in Spanish. The `<title>` and description name the
  title, the author and both ways to read: "*Marianela*, de Benito Pérez Galdós: leer y escuchar el
  audiolibro gratis". That's the combination searchers use ("<título> audiolibro", "<título> leer
  online", "<título> pdf"), and only an app with both text and audio can promise both.
- **Narrated books first.** Their pages lead with the audio and its length, and the catalogue's
  "Audiolibros" filter is the default landing view.
- **Reach every Spanish-speaking country.** No region-specific copy. Spanish and Latin American
  authors sit side by side, so Mexico, Argentina, Colombia, Peru, Chile and Spain each find their
  national classics.
- **`hreflang` between editions.** A book in more than one edition, such as *Don Quijote* in English
  and Spanish, links its pages with `hreflang`, so each search engine shows the reader's language.
- **Search Console and IndexNow**, as for English (books#48, #49), on the new domain.
- **A companion FreeWebStore site in Spanish**, like books#29, once the pilot is live.

## Before building: checklist

- [ ] **Owner:** app id and name (recommended: `libros` / Libros).
- [ ] **Owner:** rights rule (recommended: Tier A and Tier B).
- [ ] **Owner:** narrator voice, from the three samples.
- [ ] books#53, #54 (with an `es` locale), #56 (Spanish profile), #57 (Kokoro `es`) and #58 are done.
- [ ] Wave 1 texts build and pass review. Two minutes of each are narrated and listened to before
      the full run.
