import jupyter_rtc_automerge as jrtcam


# serialized backend
backend = jrtcam.automerge.new_document("document id", "Document content. Hello !")

changes = jrtcam.automerge.get_changes(backend)


print("\n\n\nbackend : \n", backend)

print("\n\n\nchanges : \n", changes)
