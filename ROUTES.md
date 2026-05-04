## Rakita Routes (`basePath`: `/rakita`)

### Classification

- **SEO listing** — Facility listing pages filtered by prefecture / municipality / designated city / station / railway line / disability type (including line + disability combinations at root level).
- **Landing page** — Service entry pages, TOP, facility search, facility / corporate details, articles.
  `http://localhost:3000` + paths in the **System URL** column.

---

## SEO Listing

### Root (All Types)

| Status | Page              | System URL                                             |
| ------ | ----------------- | ------------------------------------------------------ |
| ✅     | Prefecture        | <http://localhost:3000/rakita/1>                       |
| ✅     | Municipality      | <http://localhost:3000/rakita/19/822>                  |
| ✅     | Region            | <http://localhost:3000/rakita/1/region/1>              |
| ✅     | Station           | <http://localhost:3000/rakita/19/station/36084>        |
| ✅     | Line              | <http://localhost:3000/rakita/19/lines/11402>          |
| ✅     | Line + Disability | <http://localhost:3000/rakita/19/lines/11402/physical> |
| ✅     | Disability        | <http://localhost:3000/rakita/19/physical>             |

### Ikou (Transition Support)

| Status | Page         | System URL                                           |
| ------ | ------------ | ---------------------------------------------------- |
| ✅     | Prefecture   | <http://localhost:3000/rakita/ikou/1>                |
| ✅     | Municipality | <http://localhost:3000/rakita/ikou/19/822>           |
| ✅     | Region       | <http://localhost:3000/rakita/ikou/1/region/1>       |
| ✅     | Station      | <http://localhost:3000/rakita/ikou/19/station/36084> |
| ✅     | Line         | <http://localhost:3000/rakita/ikou/19/lines/11402>   |
| ✅     | Disability   | <http://localhost:3000/rakita/ikou/19/physical>      |

### Keizoku (A + B)

| Status | Page         | System URL                                              |
| ------ | ------------ | ------------------------------------------------------- |
| ✅     | Prefecture   | <http://localhost:3000/rakita/keizoku/1>                |
| ✅     | Municipality | <http://localhost:3000/rakita/keizoku/19/822>           |
| ✅     | Region       | <http://localhost:3000/rakita/keizoku/1/region/1>       |
| ✅     | Station      | <http://localhost:3000/rakita/keizoku/19/station/36084> |
| ✅     | Line         | <http://localhost:3000/rakita/keizoku/19/lines/11402>   |
| ✅     | Disability   | <http://localhost:3000/rakita/keizoku/19/physical>      |

### Keizoku Type A

| Status | Page         | System URL                                                     |
| ------ | ------------ | -------------------------------------------------------------- |
| ✅     | Prefecture   | <http://localhost:3000/rakita/keizoku/type_a/1>                |
| ✅     | Municipality | <http://localhost:3000/rakita/keizoku/type_a/19/822>           |
| ✅     | Region       | <http://localhost:3000/rakita/keizoku/type_a/1/region/1>       |
| ✅     | Station      | <http://localhost:3000/rakita/keizoku/type_a/19/station/36084> |
| ✅     | Line         | <http://localhost:3000/rakita/keizoku/type_a/19/lines/11402>   |
| ✅     | Disability   | <http://localhost:3000/rakita/keizoku/type_a/19/physical>      |

### Keizoku Type B

| Status | Page         | System URL                                                     |
| ------ | ------------ | -------------------------------------------------------------- |
| ✅     | Prefecture   | <http://localhost:3000/rakita/keizoku/type_b/1>                |
| ✅     | Municipality | <http://localhost:3000/rakita/keizoku/type_b/19/822>           |
| ✅     | Region       | <http://localhost:3000/rakita/keizoku/type_b/1/region/1>       |
| ✅     | Station      | <http://localhost:3000/rakita/keizoku/type_b/19/station/36084> |
| ✅     | Line         | <http://localhost:3000/rakita/keizoku/type_b/19/lines/11402>   |
| ✅     | Disability   | <http://localhost:3000/rakita/keizoku/type_b/19/physical>      |

---

## Landing Pages

### TOP & Service Entry Pages

| Status | Page                           | System URL                                    |
| ------ | ------------------------------ | --------------------------------------------- |
| ✅     | TOP                            | <http://localhost:3000/rakita/>               |
| ✅     | Transition Support TOP         | <http://localhost:3000/rakita/ikou>           |
| ✅     | Continuous Support (A + B) TOP | <http://localhost:3000/rakita/keizoku>        |
| ✅     | Continuous Support Type A TOP  | <http://localhost:3000/rakita/keizoku/type_a> |
| ✅     | Continuous Support Type B TOP  | <http://localhost:3000/rakita/keizoku/type_b> |

### Facility Search & Details

| Status | Page                | System URL                                          |
| ------ | ------------------- | --------------------------------------------------- |
| ✅     | Facility Search     | <http://localhost:3000/rakita/facility>             |
| ✅     | Facility Detail (A) | <http://localhost:3000/rakita/facility/67>          |
| ✅     | Facility Detail (B) | <http://localhost:3000/rakita/facility/49>          |
| ✅     | Facility Detail (I) | <http://localhost:3000/rakita/facility/50>          |
| ✅     | Corporate           | <http://localhost:3000/rakita/facility_corporate/1> |

### Articles

| Status | Page             | System URL                                                   |
| ------ | ---------------- | ------------------------------------------------------------ |
| ✅     | Articles         | <http://localhost:3000/rakita/articles>                      |
| ✅     | Article Category | <http://localhost:3000/rakita/articles/category/wzexok1n_ue> |
| ✅     | Article Detail   | <http://localhost:3000/rakita/articles/m2qhyngze>            |
| ✅     | Article Tag      | <http://localhost:3000/rakita/articles/tag/rm9q1lq5zn>       |

### Corporate

| Status | Page             | System URL                                          |
| ------ | ---------------- | --------------------------------------------------- |
| ✅     | Corporate Detail | <http://localhost:3000/rakita/facility_corporate/1> |
