# Replacement cover sources

These entries replace deliberately excluded Gutenberg placeholder images. Both source pages were
reviewed for their public-domain declarations, and the downloaded images were inspected before
conversion to the app's 384-pixel WebP assets.

| Book | Commons source | Selected image and provenance |
|---|---|---|
| Father Goriot | [Pere Goriot 1835 Werdet.jpg](https://commons.wikimedia.org/wiki/File:Pere_Goriot_1835_Werdet.jpg) | Title page of the 1835 Werdet edition, marked fourth edition on the scanned page. The Commons file cites the Bibliothèque nationale de France's Gallica scan and marks the image public domain (author died more than 100 years ago). |
| Jacob's Room | [Jacob's Room (Hogarth Press, 1922).pdf](https://commons.wikimedia.org/wiki/File:Jacob%27s_Room_%28Hogarth_Press%2C_1922%29.pdf) | Page 5 is the full title page of the 1922 Hogarth Press edition, scanned from HathiTrust. The file is marked PD-scan, PD-old-70, and public domain in the US. Page 1 is blank; page 3 is only the half-title. |

The cover pipeline supports `[cover] page = 5` for Commons PDF and DjVu scans. This requests the
selected page's raster thumbnail; `Special:FilePath` alone always returned the blank first page for
Jacob's Room even with a `page` query argument. A page-specific cache filename prevents that blank
first-page image from being reused.

Rebuild these assets with:

```sh
python3 scripts/catalog/covers.py ~/.cache/books-covers father-goriot jacobs-room
```

The similarly named `Le Père Goriot, 1er Volume, 1835.png` was not used: its Commons file has a
CC BY-SA declaration. No new cover was substituted for other catalog gaps without a verified
usable public-domain cover or title page.
