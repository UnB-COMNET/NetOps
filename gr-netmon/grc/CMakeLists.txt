# Fallback for examples directory if not provided by GNU Radio
if(NOT GRC_EXAMPLES_DIR)
  include(GNUInstallDirs)
  set(GRC_EXAMPLES_DIR ${CMAKE_INSTALL_DATADIR}/gnuradio/examples)
endif()

# Install all GRC block definitions
file(GLOB GRNETMON_BLOCKS "${CMAKE_CURRENT_SOURCE_DIR}/blocks/*.block.yml")
install(
  FILES ${GRNETMON_BLOCKS}
  DESTINATION ${GRC_BLOCKS_DIR}
)


