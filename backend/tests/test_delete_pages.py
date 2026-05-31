"""Tests for page deletion on export (feat-delete-pdf-page)."""

import json

import fitz


def _export(client, pdf, pages, delete_pages):
    return client.post(
        "/api/export",
        files={"file": ("d.pdf", pdf, "application/pdf")},
        data={"pages": pages, "delete_pages": json.dumps(delete_pages)},
    )


def _empty_pages_payload():
    return json.dumps([])


def _page_count(pdf_bytes):
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    n = len(doc)
    doc.close()
    return n


def test_delete_one_page(client, make_pdf):
    pdf = make_pdf(pages=3)
    r = _export(client, pdf, _empty_pages_payload(), delete_pages=[0])
    assert r.status_code == 200
    assert _page_count(r.content) == 2


def test_delete_multiple_pages(client, make_pdf):
    pdf = make_pdf(pages=4)
    r = _export(client, pdf, _empty_pages_payload(), delete_pages=[1, 2])
    assert r.status_code == 200
    assert _page_count(r.content) == 2


def test_delete_nonexistent_index_ignored(client, make_pdf):
    pdf = make_pdf(pages=2)
    r = _export(client, pdf, _empty_pages_payload(), delete_pages=[99])
    assert r.status_code == 200
    assert _page_count(r.content) == 2


def test_no_delete_keeps_all_pages(client, make_pdf):
    pdf = make_pdf(pages=2)
    r = _export(client, pdf, _empty_pages_payload(), delete_pages=[])
    assert r.status_code == 200
    assert _page_count(r.content) == 2


def test_delete_pages_filters_bool_and_negative(client, make_pdf):
    # True (bool) and -1 must be ignored; only 0 deletes a page.
    pdf = make_pdf(pages=2)
    r = _export(client, pdf, _empty_pages_payload(), delete_pages=[True, -1, 0])
    assert r.status_code == 200
    assert _page_count(r.content) == 1
