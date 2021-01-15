import jupyter_rtc_automerge as jrtcam


# serialized backend
backend = jrtcam.automerge.new_backend()

changes = jrtcam.automerge.get_changes(backend)


print("\n\n\nbackend : \n", backend)

print("\n\n\nchanges : \n", changes)
