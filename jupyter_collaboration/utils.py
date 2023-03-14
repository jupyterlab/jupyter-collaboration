
def decode_file_path(path: str):
	format, file_type, file_id = path.split(":", 2)
	return (format, file_type, file_id)

def encode_file_path(format: str, file_type: str, file_id: str):
	return f"{format}:{file_type}:{file_id}"
