import glootalk
# glootalk.start_server(port=4321, log_path=".")
# glootalk.automerge.init(log_path=".")

# print("Glootalk : websocket server running. Ready !")
# while True:
#     continue


# serialized backend
backend = glootalk.automerge.new_backend()

changes = glootalk.automerge.get_changes(backend)


print("\n\n\nbackend : \n", backend)

print("\n\n\nchanges : \n", changes)
