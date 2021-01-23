import jupyter_rtc_automerge as jra

doc = jra.automerge.new_document("document id", "Document content. Hello !")
print(f"Document : {doc}")

changes = jra.automerge.get_changes(doc)
print(f"Changes : {changes}")
