// Pruebas de IsoGridSystem: la proyeccion isometrica entre celdas y pantalla.
// Las formulas tienen que coincidir con las del editor
// (editor/src/app/core/iso-projection.ts): si divergen, lo que se ve en el
// canvas deja de coincidir con lo que dibuja el motor.

#include "doctest/doctest.h"

#include "systems/iso_grid/IsoGridSystem.hpp"

namespace {

bool Same(GridCoord a, GridCoord b) {
    return a.col == b.col && a.row == b.row;
}

}  // namespace

TEST_SUITE("grilla isometrica") {

TEST_CASE("la grilla guarda las medidas que recibe") {
    const IsoGridSystem grid(10, 8, 96, 48);
    CHECK(grid.GetGridWidth() == 10);
    CHECK(grid.GetGridHeight() == 8);
    CHECK(grid.GetTileWidth() == 96);
    CHECK(grid.GetTileHeight() == 48);
}

TEST_CASE("la celda de origen cae en el origen de la pantalla") {
    const IsoGridSystem grid(10, 10, 64, 32);
    const Vector2 screen = grid.GridToScreen(GridCoord{0, 0});
    CHECK(screen.x == doctest::Approx(0.0f));
    CHECK(screen.y == doctest::Approx(0.0f));
}

TEST_CASE("una columna mueve media celda a la derecha y una fila media a la izquierda") {
    const IsoGridSystem grid(10, 10, 64, 32);
    const Vector2 col = grid.GridToScreen(GridCoord{1, 0});
    CHECK(col.x == doctest::Approx(32.0f));
    CHECK(col.y == doctest::Approx(16.0f));
    const Vector2 row = grid.GridToScreen(GridCoord{0, 1});
    CHECK(row.x == doctest::Approx(-32.0f));
    CHECK(row.y == doctest::Approx(16.0f));
    const Vector2 both = grid.GridToScreen(GridCoord{2, 3});
    CHECK(both.x == doctest::Approx(-32.0f));
    CHECK(both.y == doctest::Approx(80.0f));
}

TEST_CASE("una posicion fraccionaria se proyecta en continuo") {
    const IsoGridSystem grid(10, 10, 64, 32);
    const Vector2 screen = grid.GridToScreen(Vector2{1.5f, 0.5f});
    CHECK(screen.x == doctest::Approx(32.0f));
    CHECK(screen.y == doctest::Approx(32.0f));
}

TEST_CASE("el centro de cada celda vuelve a su celda") {
    const IsoGridSystem grid(12, 9, 64, 32);
    for (int row = 0; row < grid.GetGridHeight(); ++row) {
        for (int col = 0; col < grid.GetGridWidth(); ++col) {
            // El centro del rombo esta media celda debajo de su punta superior.
            const Vector2 top = grid.GridToScreen(GridCoord{col, row});
            const GridCoord back = grid.ScreenToGrid(Vector2{top.x, top.y + grid.GetTileHeight() / 2.0f});
            CAPTURE(col);
            CAPTURE(row);
            CHECK(Same(back, GridCoord{col, row}));
        }
    }
}

TEST_CASE("la conversion continua es la inversa exacta de la proyeccion") {
    const IsoGridSystem grid(10, 10, 64, 32);
    const Vector2 positions[] = {{0, 0}, {3.25f, 7.5f}, {-2.0f, 1.0f}, {9.9f, 0.1f}};
    for (const Vector2& position : positions) {
        const Vector2 back = grid.ScreenToGridContinuous(grid.GridToScreen(position));
        CHECK(back.x == doctest::Approx(position.x));
        CHECK(back.y == doctest::Approx(position.y));
    }
}

TEST_CASE("un punto fuera de la grilla redondea hacia abajo y no hacia cero") {
    const IsoGridSystem grid(10, 10, 64, 32);
    // Apenas arriba de la punta de la celda (0,0): es la celda (-1,-1), y un
    // cast a int la confundiria con la (0,0).
    CHECK(Same(grid.ScreenToGrid(Vector2{0.0f, -1.0f}), GridCoord{-1, -1}));
    CHECK(Same(grid.ScreenToGrid(Vector2{-40.0f, 10.0f}), GridCoord{-1, 0}));
}

TEST_CASE("solo las celdas dentro de la grilla son validas") {
    const IsoGridSystem grid(4, 3, 64, 32);
    CHECK(grid.IsValidCoord(GridCoord{0, 0}));
    CHECK(grid.IsValidCoord(GridCoord{3, 2}));
    CHECK_FALSE(grid.IsValidCoord(GridCoord{4, 0}));
    CHECK_FALSE(grid.IsValidCoord(GridCoord{0, 3}));
    CHECK_FALSE(grid.IsValidCoord(GridCoord{-1, 0}));
    CHECK_FALSE(grid.IsValidCoord(GridCoord{0, -1}));
}

TEST_CASE("una grilla de tamano cero no tiene celdas validas") {
    const IsoGridSystem grid(0, 0, 64, 32);
    CHECK_FALSE(grid.IsValidCoord(GridCoord{0, 0}));
}

TEST_CASE("cualquier proporcion de tile sirve y no solo dos a uno") {
    const IsoGridSystem grid(10, 10, 100, 30);
    const Vector2 screen = grid.GridToScreen(GridCoord{1, 0});
    CHECK(screen.x == doctest::Approx(50.0f));
    CHECK(screen.y == doctest::Approx(15.0f));
    CHECK(Same(grid.ScreenToGrid(Vector2{screen.x, screen.y + 15.0f}), GridCoord{1, 0}));
}

}  // TEST_SUITE
