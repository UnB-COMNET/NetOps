cmake_minimum_required(VERSION 3.16)
project(gr-netmon LANGUAGES C CXX)

# Find GNU Radio to get install directories for Python and GRC blocks
find_package(Gnuradio REQUIRED)

include(GNUInstallDirs)

add_subdirectory(python)
add_subdirectory(grc)

message(STATUS "gr-netmon configured. Python dir: ${GR_PYTHON_DIR}, GRC blocks dir: ${GRC_BLOCKS_DIR}")
