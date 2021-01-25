from jupyter_rtc_automerge import textarea

doc = textarea.new_document("document id", "Document content. Hello !")
print(doc)
print(f"Document : {doc}")

changes = textarea.get_all_changes(doc)
print(f"Changes : {changes}")
