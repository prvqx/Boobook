# Test file format

A test is one `.json` file. Upload it in the proctor dashboard (**Tests → Choose file → Upload test**).
If something is wrong, the dashboard lists exactly what to fix (for example *"Section 1, question 4: give between 2 and 8 choices"*).

Text fields accept HTML, so you can use `<i>`, `<b>`, `<sup>`, `<sub>`, `<code>`, `<br>`, `<img src="...">`, tables, and lists.

The quickest way to start is to copy `sample-exam.json` (every feature) or the dashboard's starter template (minimal).

---

## The whole file

```json
{
  "id": "apush-practice-1",
  "title": "AP United States History",
  "subtitle": "Practice Exam 1",
  "settings": {
    "allowEarlySubmit": false,
    "earlyBreakEnd": false,
    "loadDelayMs": [250, 650],
    "warningMinutes": 5,
    "showResults": "none",
    "crossOut": true,
    "ruleColors": true,
    "allowBack": true
  },
  "sections": [ { ... }, { ... } ]
}
```

| Field | Required | What it does |
|---|---|---|
| `id` | no | A short name with letters, numbers, `-` or `_`. Uploading a file with the same `id` replaces that test. If you leave it out, it's made from the title. |
| `title` | yes | Shown to test takers on their home page and in the browser tab. |
| `subtitle` | no | Smaller line under the title on the home page. |
| `settings.allowEarlySubmit` | no | `false` (default, like the real AP exam): nobody can move on until the timer runs out. `true`: the Check Your Work page gets a **Submit** button. |
| `settings.earlyBreakEnd` | no | `true` shows **Resume Testing Now** right away instead of when the break timer ends. |
| `settings.loadDelayMs` | no | The short "loading" pause between questions, in milliseconds, as `[shortest, longest]`. Default `[250, 650]`. Use `[0, 0]` to turn it off. |
| `settings.warningMinutes` | no | When the time warning pops up. Default `5`. At that point the timer turns red, reappears if it was hidden, and its **Hide** button goes away. Use `0` to turn the warning off. |
| `settings.showResults` | no | What test takers see after finishing. `"none"` (default, like the real exam), `"score"` (their score per section), or `"full"` (every question with their answer, the correct answer, and your explanation). |
| `settings.crossOut` | no | Whether the answer cross-out tool (ABC) starts turned on. Default `true`. |
| `settings.ruleColors` | no | `true` (default) draws the dashed lines in Bluebook's colors. `false` makes them plain gray. |
| `settings.allowBack` | no | `false` hides **Back** and locks earlier questions, so test takers can only move forward. Default `true`. |

---

## Sections

```json
{
  "title": "Section I",
  "name": "Multiple Choice",
  "minutes": 60,
  "breakAfterMinutes": 10,
  "directions": ["First paragraph.", "Second paragraph."],
  "passages": { "poem1": { ... } },
  "reference": [ { "title": "Formulas", "html": "..." } ],
  "questions": [ ... ]
}
```

| Field | Required | What it does |
|---|---|---|
| `title` | no | Top-left of the screen. Defaults to "Section I", "Section II", … |
| `name` | no | Used in the question menu title: "Section I: **Multiple Choice** Questions". |
| `navTitle` | no | Overrides that whole menu title. |
| `type` | no | `"mcq"` or `"frq"`. Worked out automatically: if every question has `choices`, it's multiple choice. |
| `minutes` | yes | Section length. Decimals work (`0.5` = 30 seconds — handy for testing). |
| `breakAfterMinutes` | no | Length of the scheduled break **after** this section. `0` or missing = no break (the next section's directions page appears instead). |
| `directions` | no | Shown on the "Directions" page before the section and in the **Directions ⌄** popup. A string or a list of paragraphs. If missing, simple directions are generated. |
| `responseMode` | no | Free-response only. `"typed"` (default) shows the text editor. `"paper"` hides it, like the hybrid exams where answers are handwritten. |
| `reference` | no | Adds a **Reference** button to the toolbar that opens a movable panel with collapsible topics (formulas, code reference, etc.). |
| `passages` | no | Passages questions can point to (see below). |
| `questions` | yes | The questions, in order. Numbering restarts at 1 in each section, like the real exam. |

Parts like "Section I, Part A" and "Part B" are just separate sections with `breakAfterMinutes` left out.

---

## Passages (the left panel)

Any question with a `passage` gets the two-panel layout with the resizable divider. Questions without one are shown in a single centered column.

### Poem with line numbers

```json
"poem1": {
  "heading": "Questions 1 through 5. Read the following poem carefully before you choose your answers.",
  "intro": "<i>Short italic note about the poem.</i>",
  "title": "The Poem’s Title",
  "lines": [
    "First line",
    "Second line",
    "",
    "A blank string starts a new stanza (it isn't counted as a line)"
  ]
}
```

Line numbers appear the way the real exam shows them: "Line 5", then "10", "15", … Add `"lineNumbers": false` to hide them.

### Prose or anything else

```json
"essay": {
  "heading": "Questions 6 through 9. Read the following passage carefully before you choose your answers.",
  "html": [
    "First paragraph. <span data-ref=\"r6\">This sentence is what question 6 is about.</span>",
    "Second paragraph."
  ],
  "source": "Optional source line shown in small text at the end."
}
```

### Documents (DBQ style)

```json
"dbq": {
  "documents": [
    { "label": "Document 1", "title": "Source: Letter from …, 1850", "html": "Document text…" },
    { "label": "Document 2", "image": "https://example.com/cartoon.png", "source": "Source: …" }
  ]
}
```

Numbered tabs appear at the top of the left panel; test takers click a number to see that document.

A document can be just a picture, like a photo, a cartoon or a scanned page, in place of text:

```json
{ "label": "Document 3", "title": "Source: Political cartoon, 1912", "image": "cartoon-1912.jpg" }
```

---

## Pictures

You can add pictures to passages, documents, question prompts and answer choices. Test takers can click any passage or question picture to enlarge it.

**Where the picture comes from.** Each image is one of these:
- **A name from the Images tab:** upload it in the dashboard (**Images → Upload images**) and use just the name, like `"graph1.png"`. No GitHub needed. This is the easiest option.
- **A file in the project:** put it in `public/images/` and use `"/images/graph1.png"`.
- **Any public web address:** `"https://…/graph1.png"`.

**The simple way:**

```json
"image": "graph1.png"
```

**With extra details:**

```json
"image": { "src": "graph1.png", "alt": "Line graph of population", "caption": "Figure 1", "width": 420 }
```

**Several pictures:**

```json
"images": ["graph1.png", { "src": "graph2.png", "caption": "Figure 2" }]
```

| Where | How |
|---|---|
| Passage | `"image"` / `"images"` on the passage. They go below the text. Add `"imagePosition": "above"` to put them first. A passage can be only a picture. |
| Document (DBQ tabs) | `"image"` / `"images"` on the document, with or without `"html"` text. |
| Question prompt | `"image"` / `"images"` on the question. They go below the prompt, or above it with `"imagePosition": "above"`. |
| Answer choice | Write the choice as an object: `{ "text": "optional words", "image": "choiceA.png" }`. A choice can be only a picture. |
| Inside any text | `<img src="img:graph1.png">` uses an image from the Images tab. Normal `<img src="https://…">` works too. |

If a test uses an Images-tab name that hasn't been uploaded yet, the dashboard warns you when you upload the test.

---

## Multiple-choice questions

```json
{
  "passage": "poem1",
  "lines": [1, 6],
  "prompt": "Which of the following contrasts is most developed in the first stanza (lines 1-6)?»",
  "choices": ["Choice A", "Choice B", "Choice C", "Choice D"],
  "answer": "D",
  "explanation": "Only the proctor sees this."
}
```

| Field | What it does |
|---|---|
| `passage` | Id of a passage in this section's `passages`. You can also put a passage object right here. |
| `lines` | `[first, last]` — those poem lines get underlined with a gray background while this question is on screen. |
| `ref` | For `html` passages: underlines the `<span data-ref="…">` with this name. |
| `»` in the prompt | Becomes the blue **»** button that jumps the passage to the underlined part. Only works when `lines` or `ref` is set. |
| `choices` | 2 to 8 answer choices. They get letters A, B, C, … |
| `answer` | The correct letter. Optional — leave it out and the dashboard shows "answered" instead of right/wrong. Never sent to test takers. |
| `explanation` | Optional note shown to the proctor in the dashboard. |
| `id` | Optional. Defaults to `s1q1`, `s1q2`, … Don't change ids after people start the test. |

---

## Short-answer questions (type the answer)

These work like SAT math "student-produced response" questions. Test takers type into a box and see an "Answer Preview" below it. Answers are scored automatically.

```json
{
  "type": "input",
  "prompt": "What is the value of <i>x</i> if 3<i>x</i> = 2?",
  "answer": ["2/3", ".6666", ".6667", "0.666", "0.667"],
  "maxLength": 6,
  "explanation": "Divide both sides by 3."
}
```

- **`answer`:** one accepted answer, or a list of them. Matching ignores capital letters and extra spaces. Numbers match in any form, so `1/2`, `0.5` and `.5` are all the same. Long decimals are accepted when they're rounded or cut off: `.6666` and `.6667` count for `2/3`.
- **`maxLength`:** limits how many characters can be typed. Default `12`.
- **`inputLabel`:** optional text shown above the box.
- **Mixing types:** short-answer questions can be mixed with multiple-choice questions in the same section.

---

## Layout

Normally a question with a passage uses the two-panel layout. Add `"layout": "centered"` to a question to put the passage above the question in a single centered column instead.

---

## Free-response questions

```json
{ "passage": "essay2", "prompt": "In a well-written essay, analyze …", "points": 6, "rubric": "Proctor-only scoring notes" }
```

Choose-one questions (like "answer question 3 **or** 4", or "choose one of three long essays"):

```json
{
  "prompt": "Answer ONE of the following questions.",
  "choose": [
    { "label": "Question 3", "prompt": "…" },
    { "label": "Question 4", "prompt": "…", "passage": "docs" }
  ]
}
```

Test takers pick one; they can switch at any time and the work on each option is kept. The dashboard shows which one they chose and their response. `points` and `rubric` are proctor-only.

---

## Checklist before uploading

- Commas between items, but **not** after the last item in a list.
- Quotes inside text need a backslash: `"He said \"hi\""` — or use curly quotes “ ” which need nothing.
- For multiple choice, `answer` is a letter in quotes: `"B"`, not `2`. For short answer it's the text or number: `"63"` or `["0.5", "1/2"]`.
- Run the file through any "JSON validator" website if the dashboard says it isn't valid JSON.
