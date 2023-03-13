
def decode_file_path(path):
	format, file_type, file_id = path.split(":", 2)
	return (format, file_type, file_id)

def encode_file_path(format, file_type, file_id):
	return f"{format}:{file_type}:{file_id}"
