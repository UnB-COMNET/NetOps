# Install the Python package into GNU Radio's Python dir
install(
  DIRECTORY netmon
  DESTINATION ${GR_PYTHON_DIR}
  FILES_MATCHING PATTERN "*.py" PATTERN "*.json"
)
